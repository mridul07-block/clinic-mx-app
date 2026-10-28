import { addDays, istDate } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { managerAlertCounts } from '../dashboards';
import { updateEpisodeState } from '../episodes';
import {
  dischargeFeedbackTarget,
  feedbackResponses,
  feedbackSubject,
  feedbackTarget,
  insertFeedback,
  liveDischargeFeedbackLink,
  liveFeedbackLink,
} from '../feedback';
import type { StaffMember } from '../identity';
import { completePatientLinkRow, insertPatientLink } from '../patient-links';
import { auditEvent, feedback, job, patientLink, task } from '../schema';
import { escalateServiceRecovery } from '../service-recovery';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { asSystem, episodeThrough, knowledgeVersion, note, visit } from './fake-figures';
import { becomeStaff, testPhysio } from './fake-schedule';

// PAT-04: a feedback link for a visit whose consultation is signed takes the patient's answers
// once, for exactly that consultation's centre and physio, and completes; nothing for a draft, a
// used, stopped or other kind of link; patients read nothing back and nobody changes an answer.
// The Super Admin and Centre Managers read answers at their centres; the desk, Finance and the
// physio do not. The desk issues the link, at its centre only. Rolled back. CI database only.
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
const finance = member('finance@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const deskKoramangala = member('desk.koramangala@clinicmx.test');
const physioHsr = member('physio.hsr@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

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

/** From here on, as the patient behind `link`, the way `withPatientAccess` reads. */
async function asLink(tx: Tx, link: { id: string; patientId: string; purpose: string }) {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: link.purpose },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

const today = istDate(new Date());
const yes = {
  problem_explained: 'yes',
  plan_understood: 'yes',
  questions_answered: 'no',
  options_and_charges_explained: 'yes',
};

/** A consultation held yesterday at `centreId`, signed or a draft, with a feedback link. */
async function consulted(tx: Tx, centreId: string, signed = true) {
  await asSystem(tx);
  const physio = await testPhysio(tx, {
    centreIds: [centreId],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const kb = await knowledgeVersion(tx);
  const opened = await episodeThrough(tx, centreId, ['awaiting_consultation']);
  const seen = await visit(tx, {
    centreId,
    physio,
    type: 'consultation',
    day: addDays(today, -1),
    status: 'completed',
    episodeId: opened.id,
    patientId: opened.patientId,
  });
  const consultationId = await note(tx, {
    appointmentId: seen.id,
    episodeId: opened.id,
    physio,
    kbVersionId: kb,
    signedAt: signed ? new Date(Date.now() - 86_400_000) : undefined,
  });
  // Issued as the system (WhatsApp, later); the desk's own issuing is tested below.
  const link = await insertPatientLink(tx, {
    patientId: opened.patientId,
    purpose: 'feedback',
    appointmentId: seen.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return {
    episodeId: opened.id,
    patientId: opened.patientId,
    appointmentId: seen.id,
    consultationId,
    centreId,
    physio,
    link: { id: link.id, patientId: opened.patientId, purpose: 'feedback' },
  };
}

async function answer(tx: Tx, link: { id: string; patientId: string; purpose: string }) {
  await asLink(tx, link);
  const subject = await feedbackSubject(tx);
  if (!subject) throw new Error('no subject');
  await insertFeedback(tx, {
    linkId: link.id,
    subject,
    surveyVersion: 1,
    answers: yes,
    comment: 'Clear and kind',
    score: null,
  });
  return subject;
}

describe('Feedback after the consultation', () => {
  it('takes the answers once, for the consultation’s centre and physio, and completes the link', async () => {
    await rolledBack(async (tx) => {
      const held = await consulted(tx, centreIds.hsrLayout);
      const subject = await answer(tx, held.link);
      expect(subject).toEqual({
        surveyKey: 'post_consultation',
        patientId: held.patientId,
        episodeId: held.episodeId,
        appointmentId: held.appointmentId,
        consultationId: held.consultationId,
        centreId: held.centreId,
        physioId: held.physio.id,
      });
      expect(await completePatientLinkRow(tx, held.link.id)).toBe(true);
      // Nothing more on this link: closed, and the patient reads no answer back.
      expect(await feedbackSubject(tx)).toBeUndefined();
      expect(await failure(tx, (sp) => sp.select({ id: feedback.id }).from(feedback))).toBe(
        '42501',
      );
      await asSystem(tx);
      const [row] = await tx
        .select()
        .from(feedback)
        .where(eq(feedback.patientLinkId, held.link.id));
      expect(row).toMatchObject({
        surveyKey: 'post_consultation',
        surveyVersion: 1,
        centreId: held.centreId,
        physioId: held.physio.id,
        consultationId: held.consultationId,
        answers: yes,
        comment: 'Clear and kind',
      });
      const [audited] = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(eq(auditEvent.entityId, row?.id ?? ''));
      expect(audited?.actor).toBe(`patient:${held.patientId}`);
    });
  });

  it('refuses answers for another subject, a second time, a draft, and other links', async () => {
    await rolledBack(async (tx) => {
      const held = await consulted(tx, centreIds.hsrLayout);
      const other = await consulted(tx, centreIds.koramangala);
      // The link completes only once its answers are in.
      expect(
        await failure(tx, async (sp) => {
          await asLink(sp, held.link);
          await completePatientLinkRow(sp, held.link.id);
        }),
      ).toBe('42501');
      // Claiming another centre, physio or consultation.
      for (const wrong of [
        { centreId: other.centreId },
        { physioId: other.physio.id },
        { consultationId: other.consultationId, appointmentId: other.appointmentId },
      ]) {
        expect(
          await failure(tx, async (sp) => {
            await asLink(sp, held.link);
            const subject = await feedbackSubject(sp);
            if (!subject) throw new Error('no subject');
            await insertFeedback(sp, {
              linkId: held.link.id,
              subject: { ...subject, ...wrong },
              surveyVersion: 1,
              answers: yes,
              comment: null,
              score: null,
            });
          }),
        ).toBe('42501');
      }
      // Answered once: the link closes and a second answer is refused.
      await answer(tx, held.link);
      expect(await completePatientLinkRow(tx, held.link.id)).toBe(true);
      expect(
        await failure(tx, async (sp) => {
          await sp.execute(sql`set local role clinic_patient`);
          await insertFeedback(sp, {
            linkId: held.link.id,
            subject: {
              surveyKey: 'post_consultation',
              patientId: held.patientId,
              episodeId: held.episodeId,
              appointmentId: held.appointmentId,
              consultationId: held.consultationId,
              centreId: held.centreId,
              physioId: held.physio.id,
            },
            surveyVersion: 1,
            answers: yes,
            comment: null,
            score: null,
          });
        }),
      ).toBe('42501');
      // Another working link for the answered consultation shows nothing.
      await asSystem(tx);
      const again = await insertPatientLink(tx, {
        patientId: held.patientId,
        purpose: 'feedback',
        appointmentId: held.appointmentId,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await asLink(tx, { ...again, patientId: held.patientId, purpose: 'feedback' });
      expect(await feedbackSubject(tx)).toBeUndefined();
      // A draft consultation: no subject, nothing to answer.
      await asSystem(tx);
      const draft = await consulted(tx, centreIds.hsrLayout, false);
      await asLink(tx, draft.link);
      expect(await feedbackSubject(tx)).toBeUndefined();
      // A stopped link, or another kind of link for the same visit.
      await asSystem(tx);
      const stopped = await consulted(tx, centreIds.hsrLayout);
      await tx
        .update(patientLink)
        .set({ revokedAt: new Date() })
        .where(eq(patientLink.id, stopped.link.id));
      await asLink(tx, stopped.link);
      expect(await feedbackSubject(tx)).toBeUndefined();
      await asSystem(tx);
      const form = await insertPatientLink(tx, {
        patientId: stopped.patientId,
        purpose: 'health_form',
        appointmentId: stopped.appointmentId,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await asLink(tx, { ...form, patientId: stopped.patientId, purpose: 'health_form' });
      expect(await feedbackSubject(tx)).toBeUndefined();
    });
  });

  it('lets the Super Admin and Centre Managers read at their centres, nobody else, and nobody change it', async () => {
    await rolledBack(async (tx) => {
      const hsr = await consulted(tx, centreIds.hsrLayout);
      await answer(tx, hsr.link);
      await asSystem(tx);
      const whitefield = await consulted(tx, centreIds.whitefield);
      await answer(tx, whitefield.link);
      await asSystem(tx);
      const since = new Date(Date.now() - 86_400_000);
      const read = async (staff: StaffMember) => {
        await becomeStaff(tx, staff);
        const ids = (await feedbackResponses(tx, since)).map((row) => row.physioId);
        return [ids.includes(hsr.physio.id), ids.includes(whitefield.physio.id)];
      };
      expect(await read(superAdmin)).toEqual([true, true]);
      expect(await read(manager)).toEqual([true, false]);
      for (const staff of [deskHsr, finance, physioHsr]) {
        expect(await read(staff)).toEqual([false, false]);
      }
      await becomeStaff(tx, manager);
      const [row] = (await feedbackResponses(tx, since)).filter(
        (response) => response.physioId === hsr.physio.id,
      );
      expect(row).toMatchObject({ centreName: 'HSR Layout', physioName: hsr.physio.name });
      // No one changes or removes an answer, and staff never write one.
      for (const staff of [superAdmin, manager, support]) {
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, staff);
            await sp.update(feedback).set({ comment: 'changed' });
          }),
        ).toBe('42501');
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, staff);
            await sp.delete(feedback);
          }),
        ).toBe('42501');
      }
    });
  });

  it('lets the desk find the consultation and issue its link at its centre, once signed', async () => {
    await rolledBack(async (tx) => {
      const held = await consulted(tx, centreIds.hsrLayout);
      const draft = await consulted(tx, centreIds.hsrLayout, false);
      await becomeStaff(tx, deskHsr);
      expect(await feedbackTarget(tx, held.episodeId)).toEqual({
        appointmentId: held.appointmentId,
        patientId: held.patientId,
        received: false,
      });
      expect(await feedbackTarget(tx, draft.episodeId)).toBeUndefined();
      expect((await liveFeedbackLink(tx, held.appointmentId))?.id).toBe(held.link.id);
      const issue = (staff: StaffMember, of: typeof held) =>
        failure(tx, async (sp) => {
          await becomeStaff(sp, staff);
          await insertPatientLink(sp, {
            patientId: of.patientId,
            purpose: 'feedback',
            appointmentId: of.appointmentId,
            expiresAt: new Date(Date.now() + 86_400_000),
          });
        });
      expect(await issue(deskHsr, held)).toBeUndefined();
      expect(await issue(deskHsr, draft)).toBe('42501');
      expect(await issue(deskKoramangala, held)).toBe('42501');
      expect(await issue(physioHsr, held)).toBe('42501');
      await becomeStaff(tx, deskKoramangala);
      expect(await feedbackTarget(tx, held.episodeId)).toBeUndefined();
      expect(await liveFeedbackLink(tx, held.appointmentId)).toBeUndefined();
      // Once answered: received, and no new link.
      await asSystem(tx);
      await answer(tx, held.link);
      await asSystem(tx);
      await becomeStaff(tx, deskHsr);
      expect((await feedbackTarget(tx, held.episodeId))?.received).toBe(true);
      expect(await issue(deskHsr, held)).toBe('42501');
    });
  });
});

/** An episode at `centreId` treated and discharged by a consultant, with a discharge feedback link. */
async function discharged(tx: Tx, centreId: string, done = true) {
  await asSystem(tx);
  const consultant = await testPhysio(tx, {
    centreIds: [centreId],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const opened = await episodeThrough(tx, centreId, [
    'awaiting_consultation',
    'plan_proposed',
    'active',
  ]);
  if (done) {
    await becomeStaff(tx, consultant);
    expect(
      await updateEpisodeState(
        tx,
        opened.id,
        'active',
        { status: 'discharged', pausedFrom: null },
        { reason: 'patient_choice' },
      ),
    ).toBe(true);
    await asSystem(tx);
  }
  const link = await insertPatientLink(tx, {
    patientId: opened.patientId,
    purpose: 'feedback',
    episodeId: opened.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return {
    episodeId: opened.id,
    patientId: opened.patientId,
    centreId,
    consultant,
    link: { id: link.id, patientId: opened.patientId, purpose: 'feedback' },
  };
}

const atDischarge = {
  goals_achieved: 'yes',
  continue_independently: 'yes',
  satisfied_with_care: 'no',
};

// PAT-07: a feedback link for a discharged episode takes the discharge answers and the score once,
// for the episode's centre and the consultant who discharged it; nothing before discharge; the
// desk issues it at its centre only.
describe('Feedback at discharge', () => {
  it('takes the answers and score once, for the episode’s centre and its discharging consultant', async () => {
    await rolledBack(async (tx) => {
      const done = await discharged(tx, centreIds.hsrLayout);
      await asLink(tx, done.link);
      const subject = await feedbackSubject(tx);
      expect(subject).toEqual({
        surveyKey: 'discharge',
        patientId: done.patientId,
        episodeId: done.episodeId,
        appointmentId: null,
        consultationId: null,
        centreId: done.centreId,
        physioId: done.consultant.id,
      });
      if (!subject) throw new Error('no subject');
      // A score is required at discharge, and the subject cannot be changed.
      expect(
        await failure(tx, (sp) =>
          insertFeedback(sp, {
            linkId: done.link.id,
            subject,
            surveyVersion: 1,
            answers: atDischarge,
            comment: null,
            score: null,
          }),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          insertFeedback(sp, {
            linkId: done.link.id,
            subject: { ...subject, physioId: physioHsr.id },
            surveyVersion: 1,
            answers: atDischarge,
            comment: null,
            score: 9,
          }),
        ),
      ).toBe('42501');
      await insertFeedback(tx, {
        linkId: done.link.id,
        subject,
        surveyVersion: 1,
        answers: atDischarge,
        comment: 'More evening slots',
        score: 9,
      });
      expect(await completePatientLinkRow(tx, done.link.id)).toBe(true);
      // Answered: another link for the episode shows nothing.
      await asSystem(tx);
      const again = await insertPatientLink(tx, {
        patientId: done.patientId,
        purpose: 'feedback',
        episodeId: done.episodeId,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await asLink(tx, { ...again, patientId: done.patientId, purpose: 'feedback' });
      expect(await feedbackSubject(tx)).toBeUndefined();
      await asSystem(tx);
      await becomeStaff(tx, manager);
      const [row] = await feedbackResponses(tx, new Date(Date.now() - 86_400_000), 'discharge');
      expect(row).toMatchObject({
        score: 9,
        centreName: 'HSR Layout',
        physioName: done.consultant.name,
        comment: 'More evening slots',
      });
      expect(await feedbackResponses(tx, new Date(Date.now() - 86_400_000))).toEqual([]);
    });
  });

  it('opens nothing before discharge, and lets the desk issue it at its centre only', async () => {
    await rolledBack(async (tx) => {
      const active = await discharged(tx, centreIds.hsrLayout, false);
      await asLink(tx, active.link);
      expect(await feedbackSubject(tx)).toBeUndefined();
      await asSystem(tx);
      const done = await discharged(tx, centreIds.hsrLayout);
      await becomeStaff(tx, deskHsr);
      expect(await dischargeFeedbackTarget(tx, done.episodeId)).toEqual({
        patientId: done.patientId,
        received: false,
      });
      expect(await dischargeFeedbackTarget(tx, active.episodeId)).toBeUndefined();
      expect((await liveDischargeFeedbackLink(tx, done.episodeId))?.id).toBe(done.link.id);
      const issue = (staff: StaffMember, of: { episodeId: string; patientId: string }) =>
        failure(tx, async (sp) => {
          await becomeStaff(sp, staff);
          await insertPatientLink(sp, {
            patientId: of.patientId,
            purpose: 'feedback',
            episodeId: of.episodeId,
            expiresAt: new Date(Date.now() + 86_400_000),
          });
        });
      expect(await issue(deskHsr, done)).toBeUndefined();
      expect(await issue(deskHsr, active)).toBe('42501');
      expect(await issue(deskKoramangala, done)).toBe('42501');
      expect(await issue(physioHsr, done)).toBe('42501');
      expect(await issue(deskHsr, { ...done, patientId: active.patientId })).toBe('42501');
      await becomeStaff(tx, deskKoramangala);
      expect(await dischargeFeedbackTarget(tx, done.episodeId)).toBeUndefined();
      // Another centre's desk and a physio read no discharge feedback link.
      for (const staff of [deskKoramangala, physioHsr]) {
        await becomeStaff(tx, staff);
        expect(await liveDischargeFeedbackLink(tx, done.episodeId)).toBeUndefined();
      }
      // Answered: received, and the desk issues no new link.
      await asSystem(tx);
      await asLink(tx, done.link);
      const subject = await feedbackSubject(tx);
      if (!subject) throw new Error('no subject');
      await insertFeedback(tx, {
        linkId: done.link.id,
        subject,
        surveyVersion: 1,
        answers: atDischarge,
        comment: null,
        score: 3,
      });
      await asSystem(tx);
      await becomeStaff(tx, deskHsr);
      expect((await dischargeFeedbackTarget(tx, done.episodeId))?.received).toBe(true);
      expect(await issue(deskHsr, done)).toBe('42501');
    });
  });
});

// PAT-08: a No, or a score at or below `feedback.recovery_score_max` (6), gives the centre's Centre
// Managers a high task at once and queues its escalation for `feedback.escalate_hours` (24); one
// still open then gets the Clinical Director (the Super Admin) a task, once.
describe('Service recovery', () => {
  const recoveryOf = (tx: Tx, feedbackId: string) =>
    tx
      .select()
      .from(task)
      .where(
        and(
          eq(task.kind, 'feedback.service_recovery'),
          sql`${task.details} ->> 'feedbackId' = ${feedbackId}`,
        ),
      );
  const feedbackOf = async (tx: Tx, linkId: string) => {
    const [row] = await tx
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.patientLinkId, linkId));
    return row?.id ?? '';
  };

  it('gives the Centre Managers a task for a No, queues its escalation, and nothing for all Yes', async () => {
    await rolledBack(async (tx) => {
      const held = await consulted(tx, centreIds.hsrLayout);
      await answer(tx, held.link);
      await asSystem(tx);
      const [made] = await recoveryOf(tx, await feedbackOf(tx, held.link.id));
      expect(made).toMatchObject({
        title: 'Service recovery: feedback after the consultation',
        priority: 'high',
        status: 'open',
        assigneeRole: 'centre_manager',
        assigneeStaffUserId: null,
        centreId: held.centreId,
        patientId: held.patientId,
        episodeId: held.episodeId,
        details: { surveyKey: 'post_consultation', noAnswers: ['questions_answered'], score: null },
      });
      const [queued] = await tx
        .select({ runAt: job.runAt })
        .from(job)
        .where(eq(job.idempotencyKey, `feedback.recovery_escalate:${made?.id ?? ''}`));
      const hours = ((queued?.runAt.getTime() ?? 0) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThan(24.1);
      // The Centre Manager counts it among the alerts at the centre.
      await becomeStaff(tx, manager);
      const counted = (await managerAlertCounts(tx)).find(
        (row) => row.centreId === held.centreId && row.item === 'service_recovery',
      );
      expect(counted?.n).toBeGreaterThanOrEqual(1);
      // All Yes: no task.
      await asSystem(tx);
      const happy = await consulted(tx, centreIds.hsrLayout);
      await asLink(tx, happy.link);
      const subject = await feedbackSubject(tx);
      if (!subject) throw new Error('no subject');
      await insertFeedback(tx, {
        linkId: happy.link.id,
        subject,
        surveyVersion: 1,
        answers: { ...yes, questions_answered: 'yes' },
        comment: null,
        score: null,
      });
      await asSystem(tx);
      expect(await recoveryOf(tx, await feedbackOf(tx, happy.link.id))).toEqual([]);
    });
  });

  it('takes a score at or below the setting as negative at discharge, and 7 as not', async () => {
    await rolledBack(async (tx) => {
      const allYes = {
        goals_achieved: 'yes',
        continue_independently: 'yes',
        satisfied_with_care: 'yes',
      };
      const scored = async (score: number) => {
        const done = await discharged(tx, centreIds.hsrLayout);
        await asLink(tx, done.link);
        const subject = await feedbackSubject(tx);
        if (!subject) throw new Error('no subject');
        await insertFeedback(tx, {
          linkId: done.link.id,
          subject,
          surveyVersion: 1,
          answers: allYes,
          comment: null,
          score,
        });
        await asSystem(tx);
        return recoveryOf(tx, await feedbackOf(tx, done.link.id));
      };
      const [low] = await scored(6);
      expect(low).toMatchObject({
        title: 'Service recovery: feedback at discharge',
        details: { surveyKey: 'discharge', noAnswers: [], score: 6 },
      });
      expect(await scored(7)).toEqual([]);
    });
  });

  it('escalates a task still open to the Clinical Director once, and never one closed in time', async () => {
    await rolledBack(async (tx) => {
      const held = await consulted(tx, centreIds.hsrLayout);
      await answer(tx, held.link);
      await asSystem(tx);
      const [open] = await recoveryOf(tx, await feedbackOf(tx, held.link.id));
      expect(await escalateServiceRecovery(tx, open?.id ?? '')).toBe(true);
      expect(await escalateServiceRecovery(tx, open?.id ?? '')).toBe(false);
      const [director] = await tx
        .select()
        .from(task)
        .where(
          and(
            eq(task.kind, 'feedback.service_recovery_director'),
            sql`${task.details} ->> 'recoveryTaskId' = ${open?.id ?? ''}`,
          ),
        );
      expect(director).toMatchObject({
        assigneeRole: 'super_admin',
        priority: 'high',
        centreId: held.centreId,
      });
      // Closed in time: no escalation.
      const other = await consulted(tx, centreIds.hsrLayout);
      await answer(tx, other.link);
      await asSystem(tx);
      const [closed] = await recoveryOf(tx, await feedbackOf(tx, other.link.id));
      await tx
        .update(task)
        .set({ status: 'closed', closedAt: new Date(), decision: 'Called the patient; resolved.' })
        .where(eq(task.id, closed?.id ?? ''));
      expect(await escalateServiceRecovery(tx, closed?.id ?? '')).toBe(false);
    });
  });
});
