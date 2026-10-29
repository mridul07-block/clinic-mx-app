import { addDays, istDate, istInstant, type EpisodeStatus } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode, updateEpisodeState } from '../episodes';
import { reviewLinkTarget } from '../feedback';
import type { StaffMember } from '../identity';
import { centre, episode, job } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio } from './fake-schedule';

// PAT-09 done when: sent to every discharged patient with their centre's link, never filtered by
// score. Discharging any episode queues one review request for the next day at 10:00 IST, whatever
// its consultation, feedback or reason; the desk reads the centre's link for a discharged episode
// at its centre only. Rolled back. CI database only.
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
const finance = member('finance@clinicmx.test');

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

async function asSystem(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
  await tx.execute(sql`select set_config('audit.actor', 'system:tests', true)`);
}

const path: EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
];
const LINK = 'https://g.page/r/TestOnlyReview123/review';

/** An Active episode at HSR Layout (no consultation), and its discharge by a consultant. */
async function setUp(tx: Tx) {
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const active = async () => {
    const patientId = await testPatient(tx);
    const id = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
    for (let step = 1; step < path.length; step++) {
      await updateEpisodeState(tx, id, path[step - 1] as EpisodeStatus, {
        status: path[step] as EpisodeStatus,
        pausedFrom: null,
      });
    }
    return id;
  };
  const discharge = async (id: string, reason: 'goals_achieved' | 'lost_to_follow_up') => {
    await becomeStaff(tx, consultant);
    await updateEpisodeState(
      tx,
      id,
      'active',
      { status: 'discharged', pausedFrom: null },
      { reason },
    );
    await asSystem(tx);
  };
  return { active, discharge };
}

const requests = (tx: Tx, episodeId: string) =>
  tx
    .select({ runAt: job.runAt, payload: job.payload })
    .from(job)
    .where(
      and(
        eq(job.kind, 'whatsapp.review_request'),
        eq(job.idempotencyKey, ['whatsapp.review_request', episodeId].join(':')),
      ),
    );

describe('the review request', () => {
  it('is queued once for every discharged episode, the next day at 10:00 IST, never filtered', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      // No consultation, no feedback, discharged as Lost to follow-up: still asked.
      const lost = await s.active();
      expect(await requests(tx, lost)).toHaveLength(0);
      await s.discharge(lost, 'lost_to_follow_up');
      const [closed] = await tx
        .select({ closedAt: episode.closedAt })
        .from(episode)
        .where(eq(episode.id, lost));
      const day = istDate(closed?.closedAt ?? new Date());
      const [clock] = await tx.execute<{ now: string }>(sql`select now()::text as now`);
      const [queued, ...more] = await requests(tx, lost);
      expect(more).toHaveLength(0);
      expect(queued?.payload).toEqual({ episodeId: lost });
      expect(queued?.runAt.getTime()).toBe(
        Math.max(istInstant(addDays(day, 1), 600).getTime(), new Date(clock?.now ?? '').getTime()),
      );
      // Any reason, any episode.
      const done = await s.active();
      await s.discharge(done, 'goals_achieved');
      expect(await requests(tx, done)).toHaveLength(1);
    });
  });

  it('follows the settings', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(
        sql`update setting set value = '3' where key = 'feedback.review_request_days'`,
      );
      const s = await setUp(tx);
      const id = await s.active();
      await s.discharge(id, 'goals_achieved');
      const [queued] = await requests(tx, id);
      const [closed] = await tx
        .select({ closedAt: episode.closedAt })
        .from(episode)
        .where(eq(episode.id, id));
      expect(queued?.runAt.toISOString()).toBe(
        istInstant(addDays(istDate(closed?.closedAt ?? new Date()), 3), 600).toISOString(),
      );
    });
  });

  it('shows the centre’s link to the desk of a discharged episode’s centre only', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const open = await s.active();
      const gone = await s.active();
      await s.discharge(gone, 'goals_achieved');
      const read = async (who: StaffMember, id: string) => {
        await becomeStaff(tx, who);
        const target = await reviewLinkTarget(tx, id);
        await asSystem(tx);
        return target;
      };
      expect(await read(deskHsr, gone)).toEqual({ link: null });
      await tx.update(centre).set({ reviewLink: LINK }).where(eq(centre.id, centreIds.hsrLayout));
      expect(await read(deskHsr, gone)).toEqual({ link: LINK });
      expect(await read(deskHsr, open)).toBeUndefined();
      expect(await read(deskKoramangala, gone)).toBeUndefined();
      expect(await read(finance, gone)).toBeUndefined();
    });
  });
});
