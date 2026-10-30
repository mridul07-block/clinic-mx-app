import { addDays, istDate } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import {
  documentForMessage,
  feedbackSubjectOfLink,
  firstTreatmentAnswered,
  newerOpenEpisode,
  newestDocument,
  repliedMessage,
} from '../clinic-messages';
import { createDb } from '../client';
import { feedbackSubject, insertFeedback } from '../feedback';
import type { StaffMember } from '../identity';
import { queueMessageOnce } from '../messaging';
import { completePatientLinkRow, insertPatientLink } from '../patient-links';
import { document, message, task, treatmentSession } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { asSystem, claimsOf, episodeThrough, knowledgeVersion, visit } from './fake-figures';
import { testPhysio } from './fake-schedule';

// WA-06 senders: a check's message stands for a patient link, and a tap on its reply button is
// recorded as that link's answer, the same row and tasks as the link page; a job queues its message
// once; the review link belongs to an episode. Rolled back; generated people only. CI only.
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('whatsapp'), async (tx) => {
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

const today = istDate(new Date());

/** An Active episode whose session 1, yesterday, is signed: its first treatment check is open. */
async function treated(tx: Tx) {
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
  const seen = await visit(tx, {
    centreId: centreIds.hsrLayout,
    physio,
    type: 'session',
    day: addDays(today, -1),
    status: 'checked_in',
    episodeId: opened.id,
    patientId: opened.patientId,
  });
  const [session] = await tx
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
    .returning({ id: treatmentSession.id });
  if (!session) throw new Error('no session');
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
    .where(eq(treatmentSession.id, session.id));
  await asSystem(tx);
  const link = await insertPatientLink(tx, {
    patientId: opened.patientId,
    purpose: 'feedback',
    appointmentId: seen.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { ...opened, physio, appointmentId: seen.id, link };
}

describe('a check’s answer from WhatsApp', () => {
  it('is what the link page records: the same subject, one answer, Still sore’s task', async () => {
    await rolledBack(async (tx) => {
      const held = await treated(tx);
      const subject = await feedbackSubjectOfLink(tx, held.link.id);
      expect(subject).toMatchObject({
        surveyKey: 'first_treatment',
        patientId: held.patientId,
        episodeId: held.id,
        appointmentId: held.appointmentId,
        physioId: held.physio.id,
      });
      // The patient's own page reads the same through its link.
      await setAuditContext(tx, { actor: patientActor(held.patientId) });
      const claims = JSON.stringify({
        role: 'clinic_patient',
        patient_link: { id: held.link.id, patient_id: held.patientId, purpose: 'feedback' },
      });
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
      await tx.execute(sql`set local role clinic_patient`);
      expect(await feedbackSubject(tx)).toEqual(subject);
      await asSystem(tx);
      await setAuditContext(tx, { actor: systemActor('whatsapp') });

      // Recorded by the server as the router does: the link used, then the answer.
      expect(await firstTreatmentAnswered(tx, held.id)).toBe(false);
      expect(await completePatientLinkRow(tx, held.link.id)).toBe(true);
      if (!subject) throw new Error('no subject');
      await insertFeedback(tx, {
        linkId: held.link.id,
        subject,
        surveyVersion: 1,
        answers: { since_first_treatment: 'still_sore' },
        comment: null,
        score: null,
      });
      expect(await firstTreatmentAnswered(tx, held.id)).toBe(true);
      const tasks = await tx
        .select({ assignee: task.assigneeStaffUserId, priority: task.priority })
        .from(task)
        .where(and(eq(task.kind, 'review.still_sore'), eq(task.episodeId, held.id)));
      expect(tasks).toEqual([{ assignee: held.physio.id, priority: 'high' }]);
      // Answered: the link answers nothing more, and is used.
      expect(await feedbackSubjectOfLink(tx, held.link.id)).toBeUndefined();
      expect(await completePatientLinkRow(tx, held.link.id)).toBe(false);
    });
  });

  it('is found from the message of ours it replies to', async () => {
    await rolledBack(async (tx) => {
      const held = await treated(tx);
      const sourceKey = ['whatsapp.first_treatment_check', held.id].join(':');
      const values = {
        patientId: held.patientId,
        toPhone: '+919845099001',
        kind: 'template' as const,
        templateKey: 'first_treatment_check',
        templateVersion: 1,
        language: 'en',
        variables: { patient_name: 'Test' },
        createdBy: 'system:whatsapp',
        patientLinkId: held.link.id,
        sourceKey,
      };
      const id = await queueMessageOnce(tx, values);
      expect(id).toBeTruthy();
      // The job running again queues nothing more.
      expect(await queueMessageOnce(tx, values)).toBeNull();
      const rows = await tx.select().from(message).where(eq(message.sourceKey, sourceKey));
      expect(rows).toHaveLength(1);
      await tx
        .update(message)
        .set({ status: 'sent', waMessageId: 'wamid.test-check', sentAt: new Date() })
        .where(eq(message.sourceKey, sourceKey));
      expect(await repliedMessage(tx, 'wamid.test-check')).toEqual({
        id,
        templateKey: 'first_treatment_check',
        patientId: held.patientId,
        patientLinkId: held.link.id,
      });
      expect(await repliedMessage(tx, 'wamid.unknown')).toBeUndefined();
    });
  });
});

describe('what the senders check', () => {
  it('a newer episode not yet discharged holds a follow up back', async () => {
    await rolledBack(async (tx) => {
      await asSystem(tx);
      const older = await episodeThrough(tx, centreIds.hsrLayout, ['awaiting_consultation']);
      expect(await newerOpenEpisode(tx, older.id)).toBe(false);
      const newer = await episodeThrough(tx, centreIds.hsrLayout, [], older.patientId);
      // Created in the same transaction as the older one: place it after.
      await tx.execute(
        sql`update episode set created_at = now() + interval '1 minute' where id = ${newer.id}::uuid`,
      );
      expect(await newerOpenEpisode(tx, older.id)).toBe(true);
      expect(await newerOpenEpisode(tx, newer.id)).toBe(false);
    });
  });

  it('a review link belongs to an episode', async () => {
    await rolledBack(async (tx) => {
      const held = await treated(tx);
      const review = await insertPatientLink(tx, {
        patientId: held.patientId,
        purpose: 'review',
        episodeId: held.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      expect(review.id).toBeTruthy();
      expect(
        await failure(tx, (sp) =>
          insertPatientLink(sp, {
            patientId: held.patientId,
            purpose: 'review',
            appointmentId: held.appointmentId,
            expiresAt: new Date(Date.now() + 86_400_000),
          }),
        ),
      ).toBe('23514');
    });
  });
});

describe('the PDF a message carries', () => {
  it('is the newest version made from its source, and says whose it is', async () => {
    await rolledBack(async (tx) => {
      const held = await treated(tx);
      const sourceId = crypto.randomUUID();
      const made = async (version: number) => {
        const id = crypto.randomUUID();
        await tx.insert(document).values({
          id,
          kind: 'consultation_summary',
          patientId: held.patientId,
          episodeId: held.id,
          centreId: centreIds.hsrLayout,
          sourceId,
          version,
          filePath: [held.patientId, `${id}.pdf`].join('/'),
          sizeBytes: 100,
        });
        return id;
      };
      expect(await newestDocument(tx, 'consultation_summary', sourceId)).toBeUndefined();
      await made(1);
      const second = await made(2);
      expect(await newestDocument(tx, 'consultation_summary', sourceId)).toEqual({
        id: second,
        patientId: held.patientId,
      });
      expect(await newestDocument(tx, 'discharge_report', sourceId)).toBeUndefined();
      expect(await documentForMessage(tx, second)).toEqual({
        patientId: held.patientId,
        filePath: [held.patientId, `${second}.pdf`].join('/'),
      });
      expect(await documentForMessage(tx, 'not-an-id')).toBeUndefined();
    });
  });
});
