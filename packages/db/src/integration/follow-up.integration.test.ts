import { addDays, istDate, istInstant, type EpisodeStatus } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { managerAlertCounts } from '../dashboards';
import { insertEpisode, updateEpisodeState } from '../episodes';
import { feedbackSubject, followUpCheckTarget, insertFeedback } from '../feedback';
import type { StaffMember } from '../identity';
import { insertPatientLink } from '../patient-links';
import { episode, feedback, followUpSchedule, job, setting, staffUser, task } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio } from './fake-schedule';

// PAT-10 done when: 2 weeks, 6 weeks, 3 months, 12 months; "Injured again" logs a recurrence and
// alerts the consultant. Discharge queues one follow up per interval; the patient answers the due
// one once through a follow up link; Injured again gives the consultant who discharged a high task.
// Rolled back; discharges are moved back in time inside the transaction. CI database only.
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
const manager = member('manager@clinicmx.test');
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

async function asSystem(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
  await tx.execute(sql`select set_config('audit.actor', 'system:tests', true)`);
}

async function asLink(tx: Tx, link: { id: string; patientId: string; purpose: string }) {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: link.purpose },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

/** The IST date `months` after `day`, at the end of a shorter month as Postgres does. */
function addMonthsClamped(day: string, months: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return istDate(
    new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last), 6)),
  );
}

const path: EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
];

async function setUp(tx: Tx) {
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  /** A generated episode discharged by the consultant, `daysAgo` days back (0: now). */
  const discharged = async (daysAgo = 0) => {
    await asSystem(tx);
    const patientId = await testPatient(tx);
    const id = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
    for (let step = 1; step < path.length; step++) {
      await updateEpisodeState(tx, id, path[step - 1] as EpisodeStatus, {
        status: path[step] as EpisodeStatus,
        pausedFrom: null,
      });
    }
    await becomeStaff(tx, consultant);
    await updateEpisodeState(
      tx,
      id,
      'active',
      { status: 'discharged', pausedFrom: null },
      { reason: 'goals_achieved' },
    );
    await asSystem(tx);
    if (daysAgo > 0) {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx
        .update(episode)
        .set({ closedAt: sql`now() - make_interval(days => ${daysAgo})` })
        .where(eq(episode.id, id));
      await tx
        .update(followUpSchedule)
        .set({ dueOn: sql`${followUpSchedule.dueOn} - ${daysAgo}::int` })
        .where(eq(followUpSchedule.episodeId, id));
      await tx.execute(sql`set local session_replication_role = origin`);
    }
    return { id, patientId };
  };
  return { consultant, discharged };
}

/** The patient's follow up link for the episode, and their tap on it; the subject it answered. */
async function tap(
  tx: Tx,
  held: { id: string; patientId: string },
  answer: 'doing_well' | 'some_pain' | 'injured_again',
) {
  await asSystem(tx);
  const link = await insertPatientLink(tx, {
    patientId: held.patientId,
    purpose: 'follow_up',
    episodeId: held.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await asLink(tx, { id: link.id, patientId: held.patientId, purpose: 'follow_up' });
  const subject = await feedbackSubject(tx);
  if (!subject) {
    await asSystem(tx);
    return undefined;
  }
  await insertFeedback(tx, {
    linkId: link.id,
    subject,
    surveyVersion: 1,
    answers: { since_discharge: answer, follow_up: subject.followUp ?? '' },
    comment: null,
    score: null,
  });
  await asSystem(tx);
  return subject;
}

const injuredTasks = (tx: Tx, episodeId: string) =>
  tx
    .select({
      priority: task.priority,
      assignee: task.assigneeStaffUserId,
      role: task.assigneeRole,
      details: task.details,
    })
    .from(task)
    .where(and(eq(task.kind, 'review.injured_again'), eq(task.episodeId, episodeId)));

describe('the follow ups after discharge', () => {
  it('are queued at discharge, one per interval, on its day at 10:00 IST', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const held = await s.discharged();
      const [closed] = await tx
        .select({ closedAt: episode.closedAt })
        .from(episode)
        .where(eq(episode.id, held.id));
      const day = istDate(closed?.closedAt ?? new Date());
      const rows = await tx
        .select({ key: job.idempotencyKey, runAt: job.runAt, payload: job.payload })
        .from(job)
        .where(
          and(
            eq(job.kind, 'whatsapp.follow_up_check'),
            sql`${job.payload} ->> 'episodeId' = ${held.id}`,
          ),
        );
      const byKey = new Map(rows.map((r) => [(r.key ?? '').split(':').at(-1), r]));
      expect([...byKey.keys()].sort()).toEqual(['12_month', '2_week', '3_month', '6_week']);
      expect(byKey.get('2_week')?.runAt.toISOString()).toBe(
        istInstant(addDays(day, 14), 600).toISOString(),
      );
      expect(byKey.get('6_week')?.runAt.toISOString()).toBe(
        istInstant(addDays(day, 42), 600).toISOString(),
      );
      expect(byKey.get('3_month')?.runAt.toISOString()).toBe(
        istInstant(addMonthsClamped(day, 3), 600).toISOString(),
      );
      expect(byKey.get('12_month')?.payload).toEqual({
        episodeId: held.id,
        count: 12,
        unit: 'month',
      });
    });
  });

  it('take Doing well or Some pain once per interval and alert nobody', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      // Not due yet: the link opens nothing.
      const fresh = await s.discharged();
      expect(await tap(tx, fresh, 'doing_well')).toBeUndefined();
      const held = await s.discharged(20);
      expect(await tap(tx, held, 'doing_well')).toMatchObject({
        surveyKey: 'follow_up',
        followUp: '2_week',
        physioId: s.consultant.id,
      });
      // Answered: the next link opens nothing until 6 weeks.
      expect(await tap(tx, held, 'some_pain')).toBeUndefined();
      expect(await injuredTasks(tx, held.id)).toHaveLength(0);
      // A feedback link for the episode is still the discharge survey.
      const link = await insertPatientLink(tx, {
        patientId: held.patientId,
        purpose: 'feedback',
        episodeId: held.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await asLink(tx, { id: link.id, patientId: held.patientId, purpose: 'feedback' });
      expect((await feedbackSubject(tx))?.surveyKey).toBe('discharge');
      await asSystem(tx);
    });
  });

  it('turn Injured again into a high task for the consultant who discharged, counted for the manager', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const reviewsOpen = async () => {
        await becomeStaff(tx, manager);
        const counts = await managerAlertCounts(tx);
        await asSystem(tx);
        return (
          counts.find((c) => c.centreId === centreIds.hsrLayout && c.item === 'reviews_open')?.n ??
          0
        );
      };
      const before = await reviewsOpen();
      // 50 days on: 2 and 6 weeks are due; the newest is answered.
      const held = await s.discharged(50);
      expect((await tap(tx, held, 'injured_again'))?.followUp).toBe('6_week');
      expect(await injuredTasks(tx, held.id)).toEqual([
        {
          priority: 'high',
          assignee: s.consultant.id,
          role: null,
          details: { feedbackId: expect.any(String) as string, followUp: '6_week' },
        },
      ]);
      expect(await reviewsOpen()).toBe(before + 1);
      // The missed 2 week follow up has lapsed: nothing is due until 3 months.
      expect(await tap(tx, held, 'doing_well')).toBeUndefined();
      const recovery = await tx
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.kind, 'feedback.service_recovery'), eq(task.episodeId, held.id)));
      expect(recovery).toHaveLength(0);
      // The consultant no longer active: the centre's Centre Managers.
      const later = await s.discharged(20);
      await tx.update(staffUser).set({ active: false }).where(eq(staffUser.id, s.consultant.id));
      await tap(tx, later, 'injured_again');
      expect(await injuredTasks(tx, later.id)).toMatchObject([
        { assignee: null, role: 'centre_manager' },
      ]);
    });
  });

  it('are shown at the desk of the episode’s centre while one is due, and only then issued', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const fresh = await s.discharged();
      const held = await s.discharged(20);
      await becomeStaff(tx, deskHsr);
      const due = await followUpCheckTarget(tx, held.id);
      expect(due).toMatchObject({ patientId: held.patientId, due: '2_week' });
      const waiting = await followUpCheckTarget(tx, fresh.id);
      expect(waiting?.due).toBeNull();
      expect(waiting?.nextOn).toBe(addDays(istDate(new Date()), 14));
      expect(
        await failure(tx, (sp) =>
          insertPatientLink(sp, {
            patientId: fresh.patientId,
            purpose: 'follow_up',
            episodeId: fresh.id,
            expiresAt: new Date(Date.now() + 86_400_000),
          }),
        ),
      ).toBe('42501');
      await insertPatientLink(tx, {
        patientId: held.patientId,
        purpose: 'follow_up',
        episodeId: held.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await asSystem(tx);
      await becomeStaff(tx, deskKoramangala);
      expect(await followUpCheckTarget(tx, held.id)).toBeUndefined();
      await asSystem(tx);
    });
  });

  it('keep their discharge schedule, and take only the due interval, once', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const held = await s.discharged(20);
      // A later change of the setting moves nothing scheduled.
      await tx
        .update(setting)
        .set({ value: [{ count: 1, unit: 'week' }] })
        .where(eq(setting.key, 'engagement.follow_ups_after_discharge'));
      await becomeStaff(tx, deskHsr);
      expect((await followUpCheckTarget(tx, held.id))?.due).toBe('2_week');
      await asSystem(tx);
      // The patient's link records only the interval due now.
      const link = await insertPatientLink(tx, {
        patientId: held.patientId,
        purpose: 'follow_up',
        episodeId: held.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await asLink(tx, { id: link.id, patientId: held.patientId, purpose: 'follow_up' });
      const subject = await feedbackSubject(tx);
      if (!subject) throw new Error('no subject');
      expect(
        await failure(tx, (sp) =>
          insertFeedback(sp, {
            linkId: link.id,
            subject,
            surveyVersion: 1,
            answers: { since_discharge: 'doing_well', follow_up: '12_month' },
            comment: null,
            score: null,
          }),
        ),
      ).toBe('42501');
      await asSystem(tx);
      await tap(tx, held, 'some_pain');
      // Each interval once, whoever writes it.
      const [answered] = await tx
        .select({ link: feedback.patientLinkId, patientId: feedback.patientId })
        .from(feedback)
        .where(eq(feedback.episodeId, held.id));
      expect(
        await failure(tx, (sp) =>
          sp.insert(feedback).values({
            surveyKey: 'follow_up',
            surveyVersion: 1,
            patientLinkId: link.id,
            patientId: answered?.patientId ?? '',
            episodeId: held.id,
            centreId: centreIds.hsrLayout,
            physioId: s.consultant.id,
            answers: { since_discharge: 'doing_well', follow_up: '2_week' },
          }),
        ),
      ).toBe('23505');
    });
  });
});
