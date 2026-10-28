import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { flagOverdueReviews } from '../review-overdue';
import { appointment, episode, planOfCare, task } from '../schema';
import { centreIds, seedStaff } from '../seed/data';
import { asSystem, episodeThrough, knowledgeVersion, note, visit } from './fake-figures';
import { testPhysio, typeId } from './fake-schedule';

// ALT-02, in part: an Active episode past its 6 week review date, with no Review attended, none
// booked ahead and no final test, gets one task for the consultant who signed its consultation
// (the Centre Manager before one) from the daily check; running a day twice adds nothing, and an
// open task whose review is since booked closes by itself. Rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

const superAdminId = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test')?.id ?? '';
const hsr = centreIds.hsrLayout;
const today = istDate(new Date());

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

/** An Active episode whose plan's review date is `reviewDate`, signed by a consultant or not. */
async function activeEpisode(tx: Tx, reviewDate: string, signed = true) {
  const consultant = await testPhysio(tx, {
    centreIds: [hsr],
    consultant: true,
    createdBy: superAdminId,
  });
  const kb = await knowledgeVersion(tx);
  const opened = await episodeThrough(tx, hsr, [
    'awaiting_consultation',
    'plan_proposed',
    'active',
  ]);
  const seen = await visit(tx, {
    centreId: hsr,
    physio: consultant,
    type: 'consultation',
    day: addDays(today, -50),
    status: 'completed',
    episodeId: opened.id,
    patientId: opened.patientId,
  });
  const consultationId = await note(tx, {
    appointmentId: seen.id,
    episodeId: opened.id,
    physio: consultant,
    kbVersionId: kb,
    ...(signed ? { signedAt: new Date(Date.now() - 49 * 86_400_000) } : {}),
  });
  await asSystem(tx);
  await tx.insert(planOfCare).values({
    episodeId: opened.id,
    consultationId,
    version: 1,
    goals: [],
    homeProgramme: [],
    reviewDate,
    treatingPhysioId: consultant.id,
    createdBy: consultant.id,
  });
  return { episodeId: opened.id, patientId: opened.patientId, consultant };
}

/** A Review visit for the episode, `days` from today at 11:00 IST, in `status`. */
async function review(
  tx: Tx,
  fixture: Awaited<ReturnType<typeof activeEpisode>>,
  days: number,
  status: 'booked' | 'completed',
  linked = true,
) {
  const startsAt = istInstant(addDays(today, days), 11 * 60);
  await tx.insert(appointment).values({
    number: '',
    patientId: fixture.patientId,
    centreId: hsr,
    physioId: fixture.consultant.id,
    appointmentTypeId: await typeId(tx, 'review'),
    // A Review booked at the desk names no episode.
    episodeId: linked ? fixture.episodeId : null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    channel: 'front_desk',
    bookedBy: superAdminId,
    status,
    ...(status === 'completed'
      ? {
          arrivedAt: startsAt,
          checkedInBy: superAdminId,
          startedAt: startsAt,
          startedBy: fixture.consultant.id,
          completedAt: startsAt,
        }
      : {}),
  });
}

const overdueTasks = (tx: Tx, episodeId: string) =>
  tx
    .select({
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignee: task.assigneeStaffUserId,
      role: task.assigneeRole,
      decision: task.decision,
      details: task.details,
    })
    .from(task)
    .where(and(eq(task.episodeId, episodeId), eq(task.kind, 'review.overdue')));

describe('the overdue 6 week review', () => {
  it('gives the consultant one task, however often the day runs, and closes it once booked', async () => {
    await rolledBack(async (tx) => {
      const fixture = await activeEpisode(tx, addDays(today, -3));
      const now = new Date();
      expect(await flagOverdueReviews(tx, today, now)).toContain(fixture.episodeId);
      expect(await flagOverdueReviews(tx, today, now)).not.toContain(fixture.episodeId);
      const [made, ...more] = await overdueTasks(tx, fixture.episodeId);
      expect(more).toEqual([]);
      expect(made).toMatchObject({
        status: 'open',
        priority: 'normal',
        assignee: fixture.consultant.id,
        details: { reviewDate: addDays(today, -3) },
      });
      expect(made?.title).toMatch(/^6 week review overdue since /);

      // The front desk books the Review for tomorrow: the next run closes the task.
      await review(tx, fixture, 1, 'booked');
      expect(await flagOverdueReviews(tx, today, now)).not.toContain(fixture.episodeId);
      expect(await overdueTasks(tx, fixture.episodeId)).toEqual([
        expect.objectContaining({
          status: 'closed',
          decision: 'Closed automatically: the review is booked or done.',
        }),
      ]);
    });
  });

  it('flags nothing before the date, after a Review attended, or for an episode not Active', async () => {
    await rolledBack(async (tx) => {
      const now = new Date();
      const notYet = await activeEpisode(tx, addDays(today, 2));
      const seen = await activeEpisode(tx, addDays(today, -10));
      await review(tx, seen, -9, 'completed');
      const held = await activeEpisode(tx, addDays(today, -10));
      await tx
        .update(episode)
        .set({ status: 'on_hold', pausedFrom: 'active' })
        .where(eq(episode.id, held.episodeId));
      const flagged = await flagOverdueReviews(tx, today, now);
      for (const fixture of [notYet, seen, held]) {
        expect(flagged).not.toContain(fixture.episodeId);
        expect(await overdueTasks(tx, fixture.episodeId)).toEqual([]);
      }
    });
  });

  it('asks the Centre Manager when no consultation is signed', async () => {
    await rolledBack(async (tx) => {
      const fixture = await activeEpisode(tx, addDays(today, -1), false);
      expect(await flagOverdueReviews(tx, today, new Date())).toContain(fixture.episodeId);
      expect(await overdueTasks(tx, fixture.episodeId)).toEqual([
        expect.objectContaining({ assignee: null, role: 'centre_manager' }),
      ]);
    });
  });

  // Review fixes: a Review the desk booked (no episode) counts; leaving Active closes the task at
  // once, saying why.
  it('counts a Review booked at the desk, and closes the task when the episode leaves Active', async () => {
    await rolledBack(async (tx) => {
      const now = new Date();
      const desk = await activeEpisode(tx, addDays(today, -4));
      await review(tx, desk, 2, 'booked', false);
      expect(await flagOverdueReviews(tx, today, now)).not.toContain(desk.episodeId);

      const held = await activeEpisode(tx, addDays(today, -4));
      expect(await flagOverdueReviews(tx, today, now)).toContain(held.episodeId);
      await tx
        .update(episode)
        .set({ status: 'on_hold', pausedFrom: 'active' })
        .where(eq(episode.id, held.episodeId));
      expect(await overdueTasks(tx, held.episodeId)).toEqual([
        expect.objectContaining({
          status: 'closed',
          decision: 'Closed automatically: the episode is no longer Active.',
        }),
      ]);
    });
  });
});
