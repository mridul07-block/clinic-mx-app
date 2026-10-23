import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { appointment, auditEvent, bookingCounter, episode, job, setting, task } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { checkIn, markNoShow, undoNoShow } from '../slots';
import { NO_SHOW_CALL_TASK, NO_SHOW_MESSAGE_JOB, NO_SHOW_REVIEW_TASK, inboxTasks } from '../tasks';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// ALT-04 done when: a confirmed no show gives the front desk a call task, queues the message and
// counts; two missed in a row add a clinical review task for the physio; the episode is never
// changed. The desk marks and undoes under row level security, as the app does. Every test runs in
// a transaction that is rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const deskKoramangala = member('desk.koramangala@clinicmx.test');

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

/** Reads as the database owner inside the person's transaction, then goes back to their role. */
async function asOwner<R>(tx: Tx, read: () => Promise<R>): Promise<R> {
  await tx.execute(sql`reset role`);
  const result = await read();
  await tx.execute(sql`set local role authenticated`);
  return result;
}

/** A physio, a patient with an episode at HSR Layout, and appointments that have started. */
async function setUp(tx: Tx) {
  const session = await typeId(tx, 'session');
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
  /** Started `minutesAgo` minutes (and `daysAgo` days) ago. */
  const past = async (minutesAgo: number, daysAgo = 0) => {
    const startsAt = new Date(Date.now() - (minutesAgo + daysAgo * 24 * 60) * 60000);
    const [row] = await tx
      .insert(appointment)
      .values({
        number: '',
        patientId,
        episodeId,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60000),
        channel: 'front_desk',
        bookedBy: superAdmin.id,
      })
      .returning({ id: appointment.id });
    if (!row) throw new Error('The appointment was not recorded.');
    return row.id;
  };
  const tasksFor = (kind: string) =>
    tx
      .select()
      .from(task)
      .where(and(eq(task.patientId, patientId), eq(task.kind, kind)))
      .orderBy(task.createdAt);
  return { physio, patientId, episodeId, past, tasksFor };
}

const mark = (tx: Tx, appointmentId: string, by = deskHsr.id) =>
  markNoShow(tx, { appointmentId, by, now: new Date() });

describe('no show workflow', () => {
  it('gives the desk at the centre a call task, queues the message, counts it and leaves the episode', async () => {
    await rolledBack(async (tx) => {
      const { patientId, episodeId, past, tasksFor } = await setUp(tx);
      const missed = await past(3);

      await becomeStaff(tx, deskHsr);
      expect(await mark(tx, missed)).toEqual({ id: missed });
      const inbox = (await inboxTasks(tx)).filter((t) => t.patientId === patientId);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({
        kind: NO_SHOW_CALL_TASK,
        priority: 'high',
        assigneeRole: 'front_desk',
        assigneeStaffUserId: null,
        centreId: centreIds.hsrLayout,
        details: { appointmentId: missed },
      });
      expect(inbox[0]?.title).toMatch(
        /^Call about the missed \d{1,2}:\d\d [AP]M appointment on [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/,
      );

      const checks = await asOwner(tx, async () => ({
        call: (await tasksFor(NO_SHOW_CALL_TASK))[0],
        jobs: await tx
          .select({ status: job.status, payload: job.payload })
          .from(job)
          .where(eq(job.idempotencyKey, `${NO_SHOW_MESSAGE_JOB}:${missed}`)),
        reviews: await tasksFor(NO_SHOW_REVIEW_TASK),
        counter: await tx
          .select({ noShows: bookingCounter.noShows })
          .from(bookingCounter)
          .where(eq(bookingCounter.patientId, patientId)),
        episode: await tx
          .select({ status: episode.status })
          .from(episode)
          .where(eq(episode.id, episodeId)),
      }));
      expect(checks.call?.episodeId).toBe(episodeId);
      expect(checks.jobs).toEqual([{ status: 'queued', payload: { appointmentId: missed } }]);
      expect(checks.reviews).toEqual([]);
      expect(checks.counter).toEqual([{ noShows: 1 }]);
      expect(checks.episode).toEqual([{ status: 'intake_pending' }]);
      const audited = await asOwner(tx, () =>
        tx
          .select({ actor: auditEvent.actor, action: auditEvent.action })
          .from(auditEvent)
          .where(
            and(eq(auditEvent.entity, 'task'), eq(auditEvent.entityId, checks.call?.id ?? '')),
          ),
      );
      expect(audited).toEqual([{ actor: `staff:${deskHsr.id}`, action: 'insert' }]);

      // Another centre's desk does not see it.
      await becomeStaff(tx, deskKoramangala);
      expect((await inboxTasks(tx)).filter((t) => t.patientId === patientId)).toEqual([]);
    });
  });

  it('gives the physio of the second missed appointment in a row a clinical review task, once', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, past, tasksFor } = await setUp(tx);
      const first = await past(3, 2);
      const second = await past(3);
      const third = await past(2);

      await becomeStaff(tx, deskHsr);
      await mark(tx, first);
      expect(await asOwner(tx, () => tasksFor(NO_SHOW_REVIEW_TASK))).toEqual([]);
      await mark(tx, second);
      const [review] = await asOwner(tx, () => tasksFor(NO_SHOW_REVIEW_TASK));
      expect(review).toMatchObject({
        title: 'Clinical review: 2 missed appointments in a row',
        priority: 'high',
        assigneeStaffUserId: physio.id,
        assigneeRole: null,
        details: { appointmentId: second, missed: 2 },
      });
      // The desk does not see it; the physio does.
      expect((await inboxTasks(tx)).map((t) => t.kind)).not.toContain(NO_SHOW_REVIEW_TASK);
      await becomeStaff(tx, physio);
      expect(
        (await inboxTasks(tx)).filter((t) => t.patientId === patientId).map((t) => t.id),
      ).toEqual([review?.id]);

      // A third miss while the review is open adds a call task, not a second review.
      await becomeStaff(tx, deskHsr);
      await mark(tx, third);
      expect(await asOwner(tx, () => tasksFor(NO_SHOW_REVIEW_TASK))).toHaveLength(1);
      expect(await asOwner(tx, () => tasksFor(NO_SHOW_CALL_TASK))).toHaveLength(3);
    });
  });

  it('starts counting again after an attended appointment; cancelled ones are skipped', async () => {
    await rolledBack(async (tx) => {
      const attending = await setUp(tx);
      const missed = await attending.past(3, 2);
      const attended = await attending.past(5);
      const missedAgain = await attending.past(3);
      const cancelling = await setUp(tx);
      const missedFirst = await cancelling.past(3, 2);
      const cancelled = await cancelling.past(3, 1);
      const missedThen = await cancelling.past(3);
      await tx
        .update(appointment)
        .set({
          status: 'cancelled',
          changeReason: 'patient',
          changedAt: new Date(),
          changedBy: deskHsr.id,
        })
        .where(eq(appointment.id, cancelled));

      await becomeStaff(tx, deskHsr);
      await mark(tx, missed);
      await checkIn(tx, { appointmentId: attended, by: deskHsr.id, now: new Date() });
      await mark(tx, missedAgain);
      expect(await asOwner(tx, () => attending.tasksFor(NO_SHOW_REVIEW_TASK))).toEqual([]);
      await mark(tx, missedFirst);
      await mark(tx, missedThen);
      expect(await asOwner(tx, () => cancelling.tasksFor(NO_SHOW_REVIEW_TASK))).toHaveLength(1);
    });
  });

  it('closes what an undone no show raised, as the desk; marking again sends no second message', async () => {
    await rolledBack(async (tx) => {
      const { physio, past, tasksFor } = await setUp(tx);
      const first = await past(3, 2);
      const second = await past(3);

      await becomeStaff(tx, deskHsr);
      await mark(tx, first);
      await mark(tx, second);
      expect(await undoNoShow(tx, { appointmentId: second, now: new Date() })).toEqual({
        id: second,
      });
      const closed = await asOwner(tx, async () => ({
        calls: await tasksFor(NO_SHOW_CALL_TASK),
        reviews: await tasksFor(NO_SHOW_REVIEW_TASK),
      }));
      const decided = {
        status: 'closed',
        decision: 'Closed automatically: the no show was undone.',
        closedBy: deskHsr.id,
      };
      // The first miss's call stays open; the second's call is the desk's and closed.
      expect(closed.calls.map((t) => t.status)).toEqual(['open', 'closed']);
      expect(closed.calls[1]).toMatchObject({ ...decided, assigneeStaffUserId: deskHsr.id });
      expect(closed.reviews).toHaveLength(1);
      expect(closed.reviews[0]).toMatchObject({ ...decided, assigneeStaffUserId: physio.id });

      await mark(tx, second);
      const again = await asOwner(tx, async () => ({
        calls: await tasksFor(NO_SHOW_CALL_TASK),
        reviews: await tasksFor(NO_SHOW_REVIEW_TASK),
        jobs: await tx
          .select({ id: job.id })
          .from(job)
          .where(eq(job.idempotencyKey, `${NO_SHOW_MESSAGE_JOB}:${second}`)),
      }));
      expect(again.calls.map((t) => t.status)).toEqual(['open', 'closed', 'open']);
      expect(again.reviews.map((t) => t.status)).toEqual(['closed', 'open']);
      expect(again.jobs).toHaveLength(1);
    });
  });

  it('reads how many in a row from the setting', async () => {
    await rolledBack(async (tx) => {
      const { past, tasksFor } = await setUp(tx);
      await tx
        .update(setting)
        .set({ value: 3, updatedBy: 'system:tests' })
        .where(eq(setting.key, 'clinical.no_show_review_after'));
      const appointments = [await past(3, 3), await past(3, 2), await past(3)];

      await becomeStaff(tx, deskHsr);
      await mark(tx, appointments[0] ?? '');
      await mark(tx, appointments[1] ?? '');
      expect(await asOwner(tx, () => tasksFor(NO_SHOW_REVIEW_TASK))).toEqual([]);
      await mark(tx, appointments[2] ?? '');
      const reviews = await asOwner(tx, () => tasksFor(NO_SHOW_REVIEW_TASK));
      expect(reviews.map((t) => t.details)).toEqual([
        { appointmentId: appointments[2], missed: 3 },
      ]);
    });
  });
});
