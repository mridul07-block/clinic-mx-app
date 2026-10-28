import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { managerAlertCounts } from '../dashboards';
import { feedbackSubject, firstTreatmentCheckTarget, insertFeedback } from '../feedback';
import type { StaffMember } from '../identity';
import { insertPatientLink } from '../patient-links';
import { job, openingEntry, planOfCare, setting, task, treatmentSession } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { asSystem, claimsOf, episodeThrough, knowledgeVersion, note, visit } from './fake-figures';
import { becomeStaff, testPhysio } from './fake-schedule';

// PAT-05 done when: Better, Same, Still sore; Still sore alerts the physio. Signing an episode's
// session 1 queues the check for the next day at 10:00 IST; the patient answers once through a
// feedback link for that session's visit; Still sore gives the treating physio a high review task.
// Rolled back. CI database only.
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

async function asLink(tx: Tx, link: { id: string; patientId: string }) {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: 'feedback' },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

const today = istDate(new Date());

/** An Active episode with a treated session yesterday, signed by its physio now unless `draft`. */
async function treated(
  tx: Tx,
  options: { treatingPhysio?: StaffMember; sign?: boolean; opening?: boolean } = {},
) {
  await asSystem(tx);
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const kb = await knowledgeVersion(tx);
  const opened = await episodeThrough(tx, centreIds.hsrLayout, [
    'awaiting_consultation',
    'plan_proposed',
    'active',
  ]);
  if (options.treatingPhysio) {
    const seen = await visit(tx, {
      centreId: centreIds.hsrLayout,
      physio: options.treatingPhysio,
      type: 'consultation',
      day: addDays(today, -3),
      status: 'completed',
      episodeId: opened.id,
      patientId: opened.patientId,
    });
    const consultationId = await note(tx, {
      appointmentId: seen.id,
      episodeId: opened.id,
      physio: options.treatingPhysio,
      kbVersionId: kb,
      signedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.insert(planOfCare).values({
      episodeId: opened.id,
      consultationId,
      version: 1,
      goals: [{ text: 'Generated goal', patient: true }],
      interventions: ['exercise'],
      sessionsPerWeek: 2,
      weeks: 6,
      homeProgramme: [],
      reviewDate: addDays(today, 30),
      treatingPhysioId: options.treatingPhysio.id,
      createdBy: options.treatingPhysio.id,
    });
    await tx.execute(sql`set local session_replication_role = origin`);
  }
  if (options.opening) {
    // Brought in at launch, already in treatment (SCH-13); placed directly, guards off.
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.insert(openingEntry).values({
      patientId: opened.patientId,
      episodeId: opened.id,
      centreId: centreIds.hsrLayout,
      physioId: physio.id,
      sessionsLeft: 6,
      validUntil: addDays(today, 60),
      createdBy: superAdmin.id,
      updatedBy: superAdmin.id,
    });
    await tx.execute(sql`set local session_replication_role = origin`);
  }
  const session = async (day: string) => {
    const seen = await visit(tx, {
      centreId: centreIds.hsrLayout,
      physio,
      type: 'session',
      day,
      status: 'checked_in',
      episodeId: opened.id,
      patientId: opened.patientId,
    });
    const [row] = await tx
      .insert(treatmentSession)
      .values({
        appointmentId: seen.id,
        episodeId: opened.id,
        patientId: opened.patientId,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        number: 0,
        kbVersionId: kb,
      })
      .returning({ id: treatmentSession.id, number: treatmentSession.number });
    if (!row) throw new Error('no session');
    return { appointmentId: seen.id, ...row };
  };
  const sign = async (sessionId: string) => {
    await claimsOf(tx, physio);
    await tx
      .update(treatmentSession)
      .set({
        status: 'signed',
        signedBy: physio.id,
        signedAt: new Date(),
        painRest: 2,
        painActivity: 4,
        painAfter: 1,
      })
      .where(eq(treatmentSession.id, sessionId));
    await asSystem(tx);
  };
  const first = await session(addDays(today, -1));
  if (options.sign ?? true) await sign(first.id);
  return { ...opened, physio, first, session, sign };
}

const checks = (tx: Tx, episodeId: string) =>
  tx
    .select({ runAt: job.runAt, payload: job.payload })
    .from(job)
    .where(
      and(
        eq(job.kind, 'whatsapp.first_treatment_check'),
        eq(job.idempotencyKey, ['whatsapp.first_treatment_check', episodeId].join(':')),
      ),
    );

/** The patient's link for the first treatment's visit, and their tap on it. */
async function tap(
  tx: Tx,
  held: { patientId: string; first: { appointmentId: string } },
  value: 'better' | 'same' | 'still_sore',
) {
  await asSystem(tx);
  const link = await insertPatientLink(tx, {
    patientId: held.patientId,
    purpose: 'feedback',
    appointmentId: held.first.appointmentId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await asLink(tx, { id: link.id, patientId: held.patientId });
  const subject = await feedbackSubject(tx);
  if (!subject) throw new Error('no subject');
  await insertFeedback(tx, {
    linkId: link.id,
    subject,
    surveyVersion: 1,
    answers: { since_first_treatment: value },
    comment: null,
    score: null,
  });
  await asSystem(tx);
  return { link, subject };
}

const stillSore = (tx: Tx, episodeId: string) =>
  tx
    .select({
      priority: task.priority,
      assignee: task.assigneeStaffUserId,
      centreId: task.centreId,
      details: task.details,
    })
    .from(task)
    .where(and(eq(task.kind, 'review.still_sore'), eq(task.episodeId, episodeId)));

describe('the day after first treatment check', () => {
  it('is queued once per episode when session 1 is signed, for the day after its visit at 10:00 IST', async () => {
    await rolledBack(async (tx) => {
      const held = await treated(tx);
      expect(held.first.number).toBe(1);
      const [queued, ...more] = await checks(tx, held.id);
      expect(more).toHaveLength(0);
      // The visit was yesterday: today at 10:00 IST, or now when the note is signed after that.
      const [clock] = await tx.execute<{ now: string }>(sql`select now()::text as now`);
      const due = Math.max(istInstant(today, 600).getTime(), new Date(clock?.now ?? '').getTime());
      expect(queued?.runAt.getTime()).toBe(due);
      expect(queued?.payload).toEqual({
        sessionId: held.first.id,
        episodeId: held.id,
        appointmentId: held.first.appointmentId,
      });
      // Session 2 queues nothing more.
      const second = await held.session(today);
      expect(second.number).toBe(2);
      await held.sign(second.id);
      expect(await checks(tx, held.id)).toHaveLength(1);
      // A draft session 1 queues nothing.
      const draft = await treated(tx, { sign: false });
      expect(await checks(tx, draft.id)).toHaveLength(0);
      // Nor does an opening entry's: their first treatment came before launch.
      const brought = await treated(tx, { opening: true });
      expect(brought.first.number).toBe(1);
      expect(await checks(tx, brought.id)).toHaveLength(0);
      await becomeStaff(tx, deskHsr);
      expect(await firstTreatmentCheckTarget(tx, brought.id)).toBeUndefined();
      await asSystem(tx);
    });
  });

  it('takes Better or Same once and alerts nobody', async () => {
    await rolledBack(async (tx) => {
      const held = await treated(tx);
      const { subject } = await tap(tx, held, 'better');
      expect(subject).toMatchObject({
        surveyKey: 'first_treatment',
        appointmentId: held.first.appointmentId,
        consultationId: null,
        physioId: held.physio.id,
      });
      expect(await stillSore(tx, held.id)).toHaveLength(0);
      // Once per episode: a second link for the visit opens nothing.
      await expect(tap(tx, held, 'same')).rejects.toThrow('no subject');
      const sameHeld = await treated(tx);
      await tap(tx, sameHeld, 'same');
      expect(await stillSore(tx, sameHeld.id)).toHaveLength(0);
    });
  });

  it('turns Still sore into a high review task for the treating physio, never service recovery', async () => {
    await rolledBack(async (tx) => {
      const treating = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        consultant: true,
        createdBy: superAdmin.id,
      });
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
      const held = await treated(tx, { treatingPhysio: treating });
      await tap(tx, held, 'still_sore');
      expect(await stillSore(tx, held.id)).toEqual([
        {
          priority: 'high',
          assignee: treating.id,
          centreId: centreIds.hsrLayout,
          details: { feedbackId: expect.any(String) as string },
        },
      ]);
      const recovery = await tx
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.kind, 'feedback.service_recovery'), eq(task.episodeId, held.id)));
      expect(recovery).toHaveLength(0);
      // Without a plan's treating physio, the physio of the first treatment.
      const plain = await treated(tx);
      await tap(tx, plain, 'still_sore');
      expect((await stillSore(tx, plain.id))[0]?.assignee).toBe(plain.physio.id);
      // The physio reads their task.
      await becomeStaff(tx, treating);
      const mine = await tx
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.kind, 'review.still_sore'), eq(task.episodeId, held.id)));
      expect(mine).toHaveLength(1);
      await asSystem(tx);
      // Both Still sore tasks join the manager's open clinical reviews.
      expect(await reviewsOpen()).toBe(before + 2);
      await asSystem(tx);
      // Nothing but one of the three answers is stored.
      await asSystem(tx);
      const second = await treated(tx);
      const issued = await insertPatientLink(tx, {
        patientId: second.patientId,
        purpose: 'feedback',
        appointmentId: second.first.appointmentId,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await asLink(tx, { id: issued.id, patientId: second.patientId });
      const subject = await feedbackSubject(tx);
      if (!subject) throw new Error('no subject');
      expect(
        await failure(tx, (sp) =>
          insertFeedback(sp, {
            linkId: issued.id,
            subject,
            surveyVersion: 1,
            answers: { since_first_treatment: 'worse' },
            comment: null,
            score: null,
          }),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          insertFeedback(sp, {
            linkId: issued.id,
            subject,
            surveyVersion: 1,
            answers: { since_first_treatment: 'same' },
            comment: 'Free text',
            score: null,
          }),
        ),
      ).toBe('23514');
      await asSystem(tx);
    });
  });

  it('is shown at the desk of the episode’s centre once session 1 is signed', async () => {
    await rolledBack(async (tx) => {
      const draft = await treated(tx, { sign: false });
      const held = await treated(tx);
      await becomeStaff(tx, deskHsr);
      expect(await firstTreatmentCheckTarget(tx, draft.id)).toBeUndefined();
      expect(await firstTreatmentCheckTarget(tx, held.id)).toEqual({
        appointmentId: held.first.appointmentId,
        patientId: held.patientId,
        received: false,
      });
      await asSystem(tx);
      await becomeStaff(tx, deskKoramangala);
      expect(await firstTreatmentCheckTarget(tx, held.id)).toBeUndefined();
      // The desk issues the link for the first treatment's visit; not for a draft's.
      await asSystem(tx);
      await becomeStaff(tx, deskHsr);
      expect(
        await failure(tx, (sp) =>
          insertPatientLink(sp, {
            patientId: draft.patientId,
            purpose: 'feedback',
            appointmentId: draft.first.appointmentId,
            expiresAt: new Date(Date.now() + 86_400_000),
          }),
        ),
      ).toBe('42501');
      await insertPatientLink(tx, {
        patientId: held.patientId,
        purpose: 'feedback',
        appointmentId: held.first.appointmentId,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await asSystem(tx);
    });
  });
});

// PAT-06 done when: sent after session 3 closes. A message only: signing session 3 queues it at
// once, once per episode, never for an opening entry's episode.
describe('the session 3 check', () => {
  const sessionChecks = (tx: Tx, episodeId: string) =>
    tx
      .select({ runAt: job.runAt, payload: job.payload })
      .from(job)
      .where(eq(job.idempotencyKey, ['whatsapp.session_3_check', episodeId].join(':')));
  /** Signs the episode's next sessions, today, and returns their numbers. */
  const signNext = async (held: Awaited<ReturnType<typeof treated>>, count: number) => {
    const numbers: number[] = [];
    for (let i = 0; i < count; i++) {
      const next = await held.session(today);
      await held.sign(next.id);
      numbers.push(next.number);
    }
    return numbers;
  };

  it('is queued at once when session 3 is signed, once per episode, never before', async () => {
    await rolledBack(async (tx) => {
      const held = await treated(tx);
      expect(await signNext(held, 1)).toEqual([2]);
      expect(await sessionChecks(tx, held.id)).toHaveLength(0);
      const third = await held.session(today);
      expect(third.number).toBe(3);
      expect(await sessionChecks(tx, held.id)).toHaveLength(0);
      await held.sign(third.id);
      const [clock] = await tx.execute<{ now: string }>(sql`select now()::text as now`);
      const [queued, ...more] = await sessionChecks(tx, held.id);
      expect(more).toHaveLength(0);
      expect(queued?.runAt.getTime()).toBe(new Date(clock?.now ?? '').getTime());
      expect(queued?.payload).toEqual({
        sessionId: third.id,
        episodeId: held.id,
        appointmentId: third.appointmentId,
      });
      expect(await signNext(held, 1)).toEqual([4]);
      expect(await sessionChecks(tx, held.id)).toHaveLength(1);
      // An opening entry's episode: its third session here is not early progress.
      const brought = await treated(tx, { opening: true });
      expect(await signNext(brought, 2)).toEqual([2, 3]);
      expect(await sessionChecks(tx, brought.id)).toHaveLength(0);
    });
  });

  it('follows the session the setting names', async () => {
    await rolledBack(async (tx) => {
      await tx
        .update(setting)
        .set({ value: 4 })
        .where(eq(setting.key, 'feedback.session_check_number'));
      const held = await treated(tx);
      await signNext(held, 2);
      expect(await sessionChecks(tx, held.id)).toHaveLength(0);
      await signNext(held, 1);
      expect(await sessionChecks(tx, held.id)).toHaveLength(1);
    });
  });
});
