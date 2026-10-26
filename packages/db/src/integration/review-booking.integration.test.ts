import { addDays } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { REVIEW_BOOK_JOB, addReviewBookingTask, reviewBookingFacts } from '../review-booking';
import { appointment, consultation, episode, job, planOfCare, task } from '../schema';
import { centreIds, seedStaff } from '../seed/data';
import { bookAppointment } from '../slots';
import { becomeStaff, on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// OUT-06: the 6 week review in the database. Turning an episode Active queues `review.book` once,
// never again and for no other change; the job books the Review with no staff member as its
// booker (channel `automatic`); the facts it works from read the signed consultation's consultant
// and the plan's review date. Every test runs in a transaction that is rolled back. CI only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: [],
    support: row.velyxSupport ?? false,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('tests'), async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** The Postgres error code a statement failed with, inside a savepoint. */
async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

const asOwner = (tx: Tx) => tx.execute(sql`reset role`);

const moveTo = (tx: Tx, episodeId: string, status: (typeof episode.$inferSelect)['status']) =>
  tx.update(episode).set({ status }).where(eq(episode.id, episodeId));

const reviewJobs = (tx: Tx, episodeId: string) =>
  tx
    .select({ payload: job.payload })
    .from(job)
    .where(and(eq(job.kind, REVIEW_BOOK_JOB), eq(job.idempotencyKey, `review.book:${episodeId}`)));

/** A consultant at HSR and a patient whose consultation they signed, its plan reviewed in 6 weeks. */
async function signedPlan(tx: Tx) {
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
  const [visit] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId,
      centreId: centreIds.hsrLayout,
      physioId: consultant.id,
      appointmentTypeId: await typeId(tx, 'consultation'),
      episodeId,
      startsAt: on(540, addDays(testDate, -42)),
      endsAt: on(585, addDays(testDate, -42)),
      channel: 'front_desk',
      bookedBy: deskHsr.id,
    })
    .returning({ id: appointment.id });
  const [version] = await tx.execute<{ id: string }>(
    sql`insert into kb_version (number, source, report, created_by)
      select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
      returning id`,
  );
  const [signed] = await tx
    .insert(consultation)
    .values({
      appointmentId: visit?.id ?? '',
      episodeId,
      physioId: consultant.id,
      kbVersionId: version?.id ?? '',
      status: 'signed',
      signedBy: consultant.id,
      signedAt: new Date(),
    })
    .returning({ id: consultation.id });
  await tx.insert(planOfCare).values({
    episodeId,
    consultationId: signed?.id ?? '',
    version: 1,
    goals: [],
    homeProgramme: [],
    reviewDate: testDate,
    treatingPhysioId: consultant.id,
    createdBy: consultant.id,
  });
  for (const status of ['awaiting_consultation', 'plan_proposed'] as const) {
    await moveTo(tx, episodeId, status);
  }
  return { consultant, patientId, episodeId };
}

describe('the 6 week review', () => {
  it('is queued once when the episode turns Active, and for no other change', async () => {
    await rolledBack(async (tx) => {
      const { episodeId } = await signedPlan(tx);
      expect(await reviewJobs(tx, episodeId), 'not before Active').toHaveLength(0);
      await moveTo(tx, episodeId, 'active');
      expect(await reviewJobs(tx, episodeId)).toEqual([{ payload: { episodeId } }]);
      // Under review and back to Active, or anything else, queues nothing more.
      await moveTo(tx, episodeId, 'under_review');
      await moveTo(tx, episodeId, 'active');
      await tx.update(episode).set({ updatedAt: new Date() }).where(eq(episode.id, episodeId));
      expect(await reviewJobs(tx, episodeId)).toHaveLength(1);

      // Staff never add the job themselves.
      await becomeStaff(tx, deskHsr);
      expect(
        await failure(tx, (sp) =>
          sp.insert(job).values({ kind: REVIEW_BOOK_JOB, payload: { episodeId } }),
        ),
      ).toBe('42501');
    });
  });

  it('reads the consultant and review date, books with nobody as the booker, and sees it booked', async () => {
    await rolledBack(async (tx) => {
      const { consultant, patientId, episodeId } = await signedPlan(tx);
      await moveTo(tx, episodeId, 'active');
      const facts = await reviewBookingFacts(tx, episodeId);
      expect(facts).toEqual({
        status: 'active',
        centreId: centreIds.hsrLayout,
        patientId,
        reviewDate: testDate,
        consultant: { id: consultant.id, name: consultant.name },
        booked: false,
      });
      const review = await typeId(tx, 'review');
      const row = await bookAppointment(tx, {
        centreId: centreIds.hsrLayout,
        physioId: consultant.id,
        appointmentTypeId: review,
        startsAt: on(540),
        holder: `review:${episodeId}`,
        patientId,
        episodeId,
        channel: 'automatic',
        step: 15,
        now: new Date(),
      });
      const [booked] = await tx
        .select({ channel: appointment.channel, bookedBy: appointment.bookedBy })
        .from(appointment)
        .where(eq(appointment.id, row.id));
      expect(booked).toEqual({ channel: 'automatic', bookedBy: null });
      expect((await reviewBookingFacts(tx, episodeId))?.booked).toBe(true);
      // A cancelled review no longer counts.
      await tx
        .update(appointment)
        .set({
          status: 'cancelled',
          changeReason: 'patient',
          changedAt: new Date(),
          changedBy: deskHsr.id,
        })
        .where(eq(appointment.id, row.id));
      expect((await reviewBookingFacts(tx, episodeId))?.booked).toBe(false);

      await addReviewBookingTask(tx, {
        episodeId,
        centreId: centreIds.hsrLayout,
        patientId,
        reviewDate: testDate,
        searchedTo: addDays(testDate, 6),
        consultant: consultant.name,
      });
      const [made] = await tx
        .select({ role: task.assigneeRole, title: task.title, details: task.details })
        .from(task)
        .where(eq(task.episodeId, episodeId));
      expect(made).toEqual({
        role: 'front_desk',
        title: 'Book the 6 week review',
        details: {
          reviewDate: testDate,
          searchedTo: addDays(testDate, 6),
          consultant: consultant.name,
        },
      });
      await asOwner(tx);
    });
  });
});
