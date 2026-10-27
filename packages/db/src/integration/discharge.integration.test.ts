import {
  LOST_TO_FOLLOW_UP_TASK,
  addDays,
  type DischargeReason,
  type EpisodeStatus,
} from '@clinic-mx/schemas';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { updateEpisodeState } from '../episodes';
import type { StaffMember } from '../identity';
import { markLostToFollowUp, visitsAhead } from '../lost-to-follow-up';
import { appointment, consultation, episode, job, kbVersion, staffUser, task } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// OUT-10 done when: a mandatory reason from the list; the lost to follow up job never marks
// recovered. User decisions, 27 October 2026: only a consultant with the Treats patients tick
// discharges, stamped by the database, cancelling the visits booked ahead; the daily check marks
// an episode nobody attended for the period, with nothing booked ahead, Lost to follow up (never
// discharged) with a task for the consultant; booking again brings it back. Every test runs in a
// transaction that is rolled back. CI database only.
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

/** Back to the database owner, with no staff claims: the system, as the jobs run. */
async function asSystem(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

const DAY = 24 * 60 * 60 * 1000;
const path: EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
];

/** People and generated episodes at HSR Layout, as the system. */
async function setUp(tx: Tx) {
  const session = await typeId(tx, 'session');
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  /** An episode walked to `status`, opened `openedDaysAgo` days ago. */
  const episodeAt = async (status: EpisodeStatus, openedDaysAgo = 0) => {
    const patientId = await testPatient(tx);
    // The lost check counts from the opening.
    const openedAt = new Date(Date.now() - openedDaysAgo * DAY);
    const [row] = await tx
      .insert(episode)
      .values({ patientId, centreId: centreIds.hsrLayout, openedAt })
      .returning({ id: episode.id });
    if (!row) throw new Error('The episode was not recorded.');
    const id = row.id;
    for (let step = 1; step <= path.indexOf(status); step++) {
      const from = path[step - 1] as EpisodeStatus;
      await updateEpisodeState(tx, id, from, {
        status: path[step] as EpisodeStatus,
        pausedFrom: null,
      });
    }
    if (status === 'on_hold') {
      await updateEpisodeState(tx, id, 'intake_pending', {
        status: 'on_hold',
        pausedFrom: 'intake_pending',
      });
    }
    return { id, patientId };
  };
  /** A visit of the episode `daysFromNow` days away (negative: past), attended or still booked. */
  let visits = 0;
  const visit = async (
    found: { id: string; patientId: string },
    daysFromNow: number,
    attended = false,
  ) => {
    // Each an hour apart, so the physio's visits never overlap.
    visits += 1;
    const startsAt =
      daysFromNow > 0
        ? on(9 * 60 + visits * 60, addDays(testDate, daysFromNow - 30))
        : // A past visit, by design.
          new Date(Date.now() + daysFromNow * DAY - visits * 60 * 60000);
    const [row] = await tx
      .insert(appointment)
      .values({
        number: '',
        patientId: found.patientId,
        episodeId: found.id,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 45 * 60000),
        channel: 'front_desk',
        bookedBy: superAdmin.id,
        ...(attended
          ? { status: 'checked_in' as const, arrivedAt: startsAt, checkedInBy: superAdmin.id }
          : {}),
      })
      .returning({ id: appointment.id });
    if (!row) throw new Error('The appointment was not recorded.');
    return row.id;
  };
  return { consultant, physio, episodeAt, visit };
}

const discharge = (
  tx: Tx,
  id: string,
  from: EpisodeStatus,
  reason: DischargeReason = 'goals_achieved',
) => updateEpisodeState(tx, id, from, { status: 'discharged', pausedFrom: null }, { reason });

const episodeRow = async (tx: Tx, id: string) => {
  const [row] = await tx.select().from(episode).where(eq(episode.id, id));
  return row;
};

describe('discharge', () => {
  it('is by a consultant who treats patients, stamped by the database, cancelling the visits ahead', async () => {
    await rolledBack(async (tx) => {
      const { consultant, episodeAt, visit } = await setUp(tx);
      const treated = await episodeAt('active');
      const missedEarlier = await visit(treated, -2);
      const ahead = await visit(treated, 30);
      expect((await visitsAhead(tx, treated.id)).map((v) => v.id)).toEqual([ahead]);

      await becomeStaff(tx, consultant);
      expect(await discharge(tx, treated.id, 'active')).toBe(true);
      await asSystem(tx);
      const row = await episodeRow(tx, treated.id);
      expect(row).toMatchObject({
        status: 'discharged',
        dischargeReason: 'goals_achieved',
        dischargedBy: consultant.id,
      });
      expect(row?.closedAt).toBeInstanceOf(Date);
      const visits = await tx
        .select({
          id: appointment.id,
          status: appointment.status,
          reason: appointment.changeReason,
          by: appointment.changedBy,
        })
        .from(appointment)
        .where(inArray(appointment.id, [missedEarlier, ahead]));
      expect(visits.find((v) => v.id === ahead)).toMatchObject({
        status: 'cancelled',
        reason: 'clinic',
        by: consultant.id,
      });
      // A visit already past is left for the desk (no show or check in).
      expect(visits.find((v) => v.id === missedEarlier)?.status).toBe('booked');
    });
  });

  it('is refused to a physio without the Consultant tick, the desk, the system, and a consultant whose tick is off', async () => {
    await rolledBack(async (tx) => {
      const { consultant, physio, episodeAt } = await setUp(tx);
      const treated = await episodeAt('active');
      for (const actor of [physio, deskHsr]) {
        await becomeStaff(tx, actor);
        expect(await failure(tx, (sp) => discharge(sp, treated.id, 'active')), actor.email).toBe(
          '42501',
        );
        await asSystem(tx);
      }
      // The system never discharges: no job can.
      expect(await failure(tx, (sp) => discharge(sp, treated.id, 'active'))).toBe('42501');
      // The tick is read now, not from the sign in.
      await tx.update(staffUser).set({ consultant: false }).where(eq(staffUser.id, consultant.id));
      await becomeStaff(tx, consultant);
      expect(await failure(tx, (sp) => discharge(sp, treated.id, 'active'))).toBe('42501');
      await asSystem(tx);
      // Who discharged is only ever stamped by the discharge.
      expect(
        await failure(tx, (sp) =>
          sp.update(episode).set({ dischargedBy: consultant.id }).where(eq(episode.id, treated.id)),
        ),
      ).toBe('23514');
      expect((await episodeRow(tx, treated.id))?.status).toBe('active');
    });
  });

  it('as recovered needs treatment: never from an untreated or lost episode', async () => {
    await rolledBack(async (tx) => {
      const { consultant, episodeAt } = await setUp(tx);
      const proposed = await episodeAt('plan_proposed');
      await becomeStaff(tx, consultant);
      expect(await failure(tx, (sp) => discharge(sp, proposed.id, 'plan_proposed'))).toBe('23514');
      expect(await discharge(tx, proposed.id, 'plan_proposed', 'patient_choice')).toBe(true);
    });
  });
});

describe('the lost to follow up check', () => {
  it('marks only episodes nobody attended for the period with nothing booked ahead, never discharging', async () => {
    await rolledBack(async (tx) => {
      const { consultant, episodeAt, visit } = await setUp(tx);
      const stale = await episodeAt('active', 60);
      await visit(stale, -40, true);
      const bookedAhead = await episodeAt('active', 60);
      await visit(bookedAhead, -40, true);
      await visit(bookedAhead, 30);
      const recent = await episodeAt('active', 60);
      await visit(recent, -10, true);
      const held = await episodeAt('on_hold', 60);
      const neverCame = await episodeAt('plan_proposed', 40);
      const justOpened = await episodeAt('plan_proposed', 10);
      // The stale episode's consultation was signed by the consultant (triggers off to place it).
      const [version] = await tx.select({ id: kbVersion.id }).from(kbVersion).limit(1);
      const consultationVisit = await visit(stale, -59, true);
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.insert(consultation).values({
        appointmentId: consultationVisit,
        episodeId: stale.id,
        physioId: consultant.id,
        kbVersionId: version?.id ?? '',
        status: 'signed',
        signedBy: consultant.id,
        signedAt: new Date(),
      });
      await tx.execute(sql`set local session_replication_role = origin`);

      const marked = await markLostToFollowUp(tx, new Date(), 30);
      const ours = [stale, bookedAhead, recent, held, neverCame, justOpened].map((e) => e.id);
      expect(marked.filter((id) => ours.includes(id)).sort()).toEqual(
        [stale.id, neverCame.id].sort(),
      );
      const rows = await tx
        .select({ id: episode.id, status: episode.status, pausedFrom: episode.pausedFrom })
        .from(episode)
        .where(inArray(episode.id, ours));
      const statusOf = (id: string) => rows.find((r) => r.id === id);
      expect(statusOf(stale.id)).toMatchObject({
        status: 'lost_to_follow_up',
        pausedFrom: 'active',
      });
      expect(statusOf(neverCame.id)).toMatchObject({
        status: 'lost_to_follow_up',
        pausedFrom: 'plan_proposed',
      });
      for (const kept of [bookedAhead, recent, justOpened]) {
        expect(statusOf(kept.id)?.status).not.toBe('lost_to_follow_up');
      }
      expect(statusOf(held.id)?.status).toBe('on_hold');
      expect(rows.every((r) => r.status !== 'discharged')).toBe(true);

      const tasks = await tx
        .select()
        .from(task)
        .where(and(eq(task.kind, LOST_TO_FOLLOW_UP_TASK), inArray(task.episodeId, ours)));
      expect(tasks).toHaveLength(2);
      expect(tasks.find((t) => t.episodeId === stale.id)).toMatchObject({
        priority: 'high',
        assigneeStaffUserId: consultant.id,
        assigneeRole: null,
        status: 'open',
      });
      expect(tasks.find((t) => t.episodeId === stale.id)?.title).toMatch(
        /^Lost to follow up: no visit since \d{1,2} [A-Z][a-z]{2,3} \d{4}$/,
      );
      // Before a signed consultation, the centre's Centre Manager calls.
      expect(tasks.find((t) => t.episodeId === neverCame.id)).toMatchObject({
        assigneeRole: 'centre_manager',
        centreId: centreIds.hsrLayout,
      });

      // Running the day again changes nothing.
      expect(
        (await markLostToFollowUp(tx, new Date(), 30)).filter((id) => ours.includes(id)),
      ).toEqual([]);
    });
  });

  it('is undone by booking again, and closed by a discharge, which is never as recovered', async () => {
    await rolledBack(async (tx) => {
      const { consultant, episodeAt, visit } = await setUp(tx);
      const stale = await episodeAt('active', 60);
      await visit(stale, -40, true);
      const other = await episodeAt('active', 60);
      await visit(other, -40, true);
      await markLostToFollowUp(tx, new Date(), 30);
      const lostTask = async (id: string) => {
        const [row] = await tx
          .select()
          .from(task)
          .where(and(eq(task.kind, LOST_TO_FOLLOW_UP_TASK), eq(task.episodeId, id)));
        return row;
      };

      // Booked again (the desk): back to Active, the task closed by them.
      const claims = JSON.stringify({ clinic: { staff_id: deskHsr.id } });
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
      await visit(stale, 30);
      await asSystem(tx);
      expect(await episodeRow(tx, stale.id)).toMatchObject({ status: 'active', pausedFrom: null });
      expect(await lostTask(stale.id)).toMatchObject({
        status: 'closed',
        decision: 'Closed automatically: booked again.',
        closedBy: deskHsr.id,
      });

      // A lost episode is never discharged as recovered; Lost to follow-up closes it and the task.
      await becomeStaff(tx, consultant);
      expect(await failure(tx, (sp) => discharge(sp, other.id, 'lost_to_follow_up'))).toBe('23514');
      expect(await discharge(tx, other.id, 'lost_to_follow_up', 'lost_to_follow_up')).toBe(true);
      await asSystem(tx);
      expect(await lostTask(other.id)).toMatchObject({
        status: 'closed',
        decision: 'Closed automatically: the episode was discharged.',
        closedBy: consultant.id,
      });
    });
  });
});

// OUT-11: the discharge report, queued with the discharge once there was a signed consultation;
// what it prints from the discharge is written with it, and only then.
describe('the discharge report', () => {
  it('is queued with its message on discharge, only after a signed consultation', async () => {
    await rolledBack(async (tx) => {
      const { consultant, episodeAt, visit } = await setUp(tx);
      const consulted = await episodeAt('active');
      const neverConsulted = await episodeAt('active');
      const [version] = await tx.select({ id: kbVersion.id }).from(kbVersion).limit(1);
      const seen = await visit(consulted, -3, true);
      // A signed consultation placed directly (triggers off), as the lost check test does.
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.insert(consultation).values({
        appointmentId: seen,
        episodeId: consulted.id,
        physioId: consultant.id,
        kbVersionId: version?.id ?? '',
        status: 'signed',
        signedBy: consultant.id,
        signedAt: new Date(),
      });
      await tx.execute(sql`set local session_replication_role = origin`);

      await becomeStaff(tx, consultant);
      for (const found of [consulted, neverConsulted]) {
        expect(await discharge(tx, found.id, 'active')).toBe(true);
      }
      await asSystem(tx);
      const queued = await tx
        .select({
          kind: job.kind,
          key: job.idempotencyKey,
          episodeId: sql<string>`${job.payload} ->> 'episodeId'`,
        })
        .from(job)
        .where(
          and(
            inArray(job.kind, ['documents.discharge_report', 'whatsapp.discharge_report']),
            sql`${job.payload} ->> 'episodeId' in ${[consulted.id, neverConsulted.id]}`,
          ),
        );
      expect(queued.map((q) => [q.kind, q.key, q.episodeId]).sort()).toEqual([
        ['documents.discharge_report', `discharge_report:${consulted.id}`, consulted.id],
        ['whatsapp.discharge_report', `whatsapp.discharge_report:${consulted.id}`, consulted.id],
      ]);
    });
  });

  it('keeps the goals, ongoing needs and recommendations written with the discharge, and only then', async () => {
    await rolledBack(async (tx) => {
      const { consultant, episodeAt } = await setUp(tx);
      const treated = await episodeAt('active');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(episode)
            .set({ dischargeOngoingNeeds: 'Too early.' })
            .where(eq(episode.id, treated.id)),
        ),
      ).toBe('23514');
      await becomeStaff(tx, consultant);
      expect(
        await updateEpisodeState(
          tx,
          treated.id,
          'active',
          { status: 'discharged', pausedFrom: null },
          {
            reason: 'goals_achieved',
            goals: [{ text: 'Run 5 km', outcome: 'partly_achieved' }],
            ongoingNeeds: ' Keep the home programme. ',
            recommendations: '',
          },
        ),
      ).toBe(true);
      await asSystem(tx);
      expect(await episodeRow(tx, treated.id)).toMatchObject({
        dischargeGoals: [{ text: 'Run 5 km', outcome: 'partly_achieved' }],
        dischargeOngoingNeeds: 'Keep the home programme.',
        dischargeRecommendations: null,
      });
      // A discharged episode never changes.
      expect(
        await failure(tx, (sp) =>
          sp
            .update(episode)
            .set({ dischargeRecommendations: 'Later.' })
            .where(eq(episode.id, treated.id)),
        ),
      ).toBe('23514');
    });
  });
});
