import { addDays, istDate, istInstant, type SignedRows } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { addAddendum, consultationAddenda, signConsultation } from '../clinical-record';
import { consultationSummaryFacts } from '../consultation-summary';
import { consultationRecord, openConsultation } from '../consultations';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { startVisit } from '../my-patients';
import {
  episodePlan,
  episodePrecautions,
  logClinicalView,
  patientAlertHistory,
  signedNotesOf,
} from '../patient-record';
import { insertConsultationRedFlag, moveRedFlagAlert, openRedFlagAlerts } from '../red-flag-alerts';
import { planChoicesOf, recordPlanChoice, thinkAboutItFollowUp } from '../plan-choice';
import { planForPricing } from '../plan-sheet';
import { referralLetterFacts } from '../referral-letter';
import {
  appointment,
  auditEvent,
  consultation,
  diagnosis,
  episode,
  job,
  kbCondition,
  measure,
  planModality,
  planOfCare,
  precaution,
  priceItem,
  redFlagAlert,
  specialTestResult,
  staffUser,
  task,
} from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// CLN-09 done when: signing requires the Treats patients tick; later changes are only addenda.
// Under row level security, in transactions rolled back: the record's rows are written only in
// the signing transaction, never change, and are read by clinicians at the episode's centre.
// CI only.
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
const manager = member('manager@clinicmx.test');
const finance = member('finance@clinicmx.test');
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

/**
 * A consultant with a started consultation at HSR Layout on a knowledge base version holding
 * KNE-004, colleagues there and at Koramangala, and the rows signing writes.
 */
async function setUp(tx: Tx) {
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const colleague = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const elsewhere = await testPhysio(tx, {
    centreIds: [centreIds.koramangala],
    createdBy: superAdmin.id,
  });
  const [version] = await tx.execute<{ id: string }>(
    sql`insert into kb_version (number, source, report, created_by)
      select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
      returning id`,
  );
  const kbVersionId = version?.id ?? '';
  await tx.insert(kbCondition).values({
    kbVersionId,
    conditionId: 'KNE-004',
    name: 'Patellar Tendinopathy',
    homeRegion: 'knee',
  });
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
  const startsAt = new Date(Date.now() - 5 * 60000);
  const [visit] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId,
      centreId: centreIds.hsrLayout,
      physioId: consultant.id,
      appointmentTypeId: await typeId(tx, 'consultation'),
      episodeId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60000),
      channel: 'front_desk',
      bookedBy: superAdmin.id,
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: deskHsr.id,
    })
    .returning({ id: appointment.id });
  const appointmentId = visit?.id ?? '';
  await becomeStaff(tx, consultant);
  await startVisit(tx, { appointmentId, by: consultant.id, now: new Date() });
  const consultationId = await openConsultation(tx, {
    appointmentId,
    episodeId,
    physioId: consultant.id,
  });
  const rows: SignedRows = {
    measures: [
      { key: 'knee.lsi.quadriceps', limb: 'involved', side: 'right', value: 32, unit: 'kg' },
      { key: 'knee.lsi.quadriceps', limb: 'uninvolved', side: 'left', value: 40, unit: 'kg' },
    ],
    tests: [{ key: 'knee.lachman', result: 'negative', interpretation: '' }],
    diagnosis: {
      conditionId: 'KNE-004',
      movement: 'Quad dominance',
      irritability: 'moderate',
      stage: 'subacute',
      categoryCode: null,
      provisional: true,
    },
    plan: {
      goals: [{ text: 'Run 10 km again', patient: true }],
      interventions: ['exercise'],
      modalities: [{ key: 'laser', reason: '' }],
      sessionsPerWeek: 2,
      weeks: 6,
      homeProgramme: [{ exercise: 'Spanish squat', dose: '5 x 45 s', note: '' }],
      reviewDate: '2026-12-05',
      questionnaires: ['visa_p'],
      treatingPhysioId: consultant.id,
      investigations: 'MRI of the right knee if no better in 4 weeks',
      referral: '',
    },
  };
  const sign = (by: StaffMember = consultant, baseVersion = 1) =>
    signConsultation(tx, {
      consultationId,
      baseVersion,
      by: by.id,
      episodeId,
      appointmentId,
      kbVersionId,
      rows,
    });
  return {
    consultant,
    colleague,
    elsewhere,
    patientId,
    consultationId,
    episodeId,
    appointmentId,
    sign,
  };
}

describe('signing a consultation', () => {
  it('signs with the tick, writes the record and completes the visit, audited as the consultant', async () => {
    await rolledBack(async (tx) => {
      const { consultant, consultationId, appointmentId, sign } = await setUp(tx);
      expect(await sign()).toBe('signed');
      const [signed] = await tx
        .select({ status: consultation.status, signedBy: consultation.signedBy })
        .from(consultation)
        .where(eq(consultation.id, consultationId));
      expect(signed).toEqual({ status: 'signed', signedBy: consultant.id });
      const measures = await tx
        .select({ limb: measure.limb, side: measure.side, value: measure.value })
        .from(measure)
        .where(eq(measure.consultationId, consultationId));
      expect(measures).toEqual(
        expect.arrayContaining([
          { limb: 'involved', side: 'right', value: 32 },
          { limb: 'uninvolved', side: 'left', value: 40 },
        ]),
      );
      expect(
        await tx.select().from(diagnosis).where(eq(diagnosis.consultationId, consultationId)),
      ).toEqual([expect.objectContaining({ conditionId: 'KNE-004', stage: 'subacute' })]);
      const [plan] = await tx
        .select()
        .from(planOfCare)
        .where(eq(planOfCare.consultationId, consultationId));
      expect(plan).toMatchObject({ version: 1, reviewDate: '2026-12-05', weeks: 6 });
      expect(
        await tx
          .select({ key: planModality.modalityKey })
          .from(planModality)
          .where(eq(planModality.planOfCareId, plan?.id ?? '')),
      ).toEqual([{ key: 'laser' }]);
      const [visit] = await tx
        .select({ status: appointment.status, completedAt: appointment.completedAt })
        .from(appointment)
        .where(eq(appointment.id, appointmentId));
      expect(visit?.status).toBe('completed');
      expect(visit?.completedAt).not.toBeNull();
      await asOwner(tx);
      const audited = await tx
        .select({ entity: auditEvent.entity, actor: auditEvent.actor })
        .from(auditEvent)
        .where(
          and(
            sql`${auditEvent.at} = now()`,
            sql`${auditEvent.entity} in ('measure', 'diagnosis', 'plan_of_care')`,
          ),
        );
      expect(audited.length).toBe(4);
      expect(audited.every((row) => row.actor === `staff:${consultant.id}`)).toBe(true);
    });
  });

  it('never changes once signed, and its rows are written only while it is signed', async () => {
    await rolledBack(async (tx) => {
      const { consultant, consultationId, episodeId, sign } = await setUp(tx);
      expect(await sign()).toBe('signed');
      // The consultant saves nothing more; the owner is refused by the guard.
      const saved = await tx
        .update(consultation)
        .set({ sections: { plan: { notes: 'Later' } } })
        .where(eq(consultation.id, consultationId))
        .returning({ id: consultation.id });
      expect(saved).toEqual([]);
      expect(
        await tx
          .update(measure)
          .set({ value: 99 })
          .where(eq(measure.consultationId, consultationId))
          .returning({ id: measure.id }),
      ).toEqual([]);
      expect(
        await tx
          .delete(diagnosis)
          .where(eq(diagnosis.consultationId, consultationId))
          .returning({ id: diagnosis.id }),
      ).toEqual([]);
      await asOwner(tx);
      expect(
        await failure(tx, (sp) =>
          sp.update(consultation).set({ sections: {} }).where(eq(consultation.id, consultationId)),
        ),
      ).toBe('23514');
      // Signed a minute ago, not in this transaction: no more rows.
      await tx.execute(sql`alter table consultation disable trigger consultation_guard`);
      await tx
        .update(consultation)
        .set({ signedAt: sql`now() - interval '1 minute'` })
        .where(eq(consultation.id, consultationId));
      await tx.execute(sql`alter table consultation enable trigger consultation_guard`);
      await becomeStaff(tx, consultant);
      expect(
        await failure(tx, (sp) =>
          sp.insert(measure).values({
            episodeId,
            consultationId,
            kbVersionId: sql`(select kb_version_id from consultation where id = ${consultationId})`,
            measureKey: 'knee.lsi.quadriceps',
            value: 1,
            unit: 'kg',
            createdBy: consultant.id,
          }),
        ),
      ).toBe('42501');
    });
  });

  it('is signed only by its own consultant with the Treats patients tick now', async () => {
    await rolledBack(async (tx) => {
      const { consultant, colleague, sign } = await setUp(tx);
      // Another physio sees no draft to sign.
      await becomeStaff(tx, colleague);
      expect(await sign(colleague)).toBe('stale');
      // Velyx support writes nothing.
      await becomeStaff(tx, support);
      expect(await sign(support)).toBe('stale');
      // Deactivated (a physio always treats); the token still says otherwise, the guard reads the
      // record.
      await asOwner(tx);
      await tx.update(staffUser).set({ active: false }).where(eq(staffUser.id, consultant.id));
      await becomeStaff(tx, consultant);
      expect(await failure(tx, () => sign())).toBe('42501');
      await asOwner(tx);
      await tx.update(staffUser).set({ active: true }).where(eq(staffUser.id, consultant.id));
      await becomeStaff(tx, consultant);
      // A version the consultant did not see is stale.
      expect(await sign(consultant, 9)).toBe('stale');
      expect(await sign()).toBe('signed');
    });
  });

  it('completes the visit only once its consultation is signed', async () => {
    await rolledBack(async (tx) => {
      const { appointmentId } = await setUp(tx);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({ status: 'completed', completedAt: new Date() })
            .where(eq(appointment.id, appointmentId)),
        ),
      ).toBe('42501');
    });
  });
});

describe('addenda', () => {
  it('are added to a signed consultation by clinicians at its centre, and read there only', async () => {
    await rolledBack(async (tx) => {
      const { consultant, colleague, elsewhere, consultationId, episodeId, sign } = await setUp(tx);
      const entry = (authorId: string, text = 'Seen again') => ({
        consultationId,
        episodeId,
        text,
        authorId,
      });
      // Not on a draft.
      expect(await failure(tx, (sp) => addAddendum(sp, entry(consultant.id)))).toBe('42501');
      expect(await sign()).toBe('signed');
      await addAddendum(tx, entry(consultant.id, 'Corrected the side: right knee.'));
      await becomeStaff(tx, colleague);
      // The colleague reads the signed consultation, its visit included (not before signing).
      expect((await consultationRecord(tx, consultationId))?.status).toBe('signed');
      await addAddendum(tx, entry(colleague.id));
      // Both written at this transaction's time; in use each has its own.
      expect((await consultationAddenda(tx, consultationId)).map((a) => a.text).sort()).toEqual([
        'Corrected the side: right knee.',
        'Seen again',
      ]);
      expect(
        (
          await tx
            .select({ id: specialTestResult.id })
            .from(specialTestResult)
            .where(eq(specialTestResult.consultationId, consultationId))
        ).length,
      ).toBe(1);
      // Nobody writes as someone else, and the desk, another centre and support add nothing.
      expect(await failure(tx, (sp) => addAddendum(sp, entry(consultant.id)))).toBe('42501');
      for (const outsider of [deskHsr, elsewhere, support]) {
        await becomeStaff(tx, outsider);
        expect(await failure(tx, (sp) => addAddendum(sp, entry(outsider.id))), outsider.email).toBe(
          '42501',
        );
      }
      // The desk reads none of it; another centre's clinicians do (CLN-12, below).
      await becomeStaff(tx, deskHsr);
      expect(await consultationAddenda(tx, consultationId)).toEqual([]);
      expect(await consultationRecord(tx, consultationId)).toBeUndefined();
      expect(
        await tx.select().from(measure).where(eq(measure.consultationId, consultationId)),
      ).toEqual([]);
    });
  });
});

// CLN-12 done when: the patient record shows the summary card, episodes, signed notes, documents
// and alerts. Kickoff decision C1: clinicians read signed records at any centre, each open a
// record view; operational lists keep their centre scope.
describe('the patient record', () => {
  /** A signed consultation at HSR Layout with an addendum, a precaution and a raised alert. */
  async function signedAtHsr(tx: Tx) {
    const setup = await setUp(tx);
    expect(await setup.sign()).toBe('signed');
    await addAddendum(tx, {
      consultationId: setup.consultationId,
      episodeId: setup.episodeId,
      text: 'Corrected the side: right knee.',
      authorId: setup.consultant.id,
    });
    await asOwner(tx);
    const [kb] = await tx
      .select({ id: consultation.kbVersionId })
      .from(consultation)
      .where(eq(consultation.id, setup.consultationId));
    await tx.insert(precaution).values({
      episodeId: setup.episodeId,
      key: 'pregnancy',
      label: 'Pregnancy',
      source: 'health_form',
      formVersion: 'test',
    });
    await tx.insert(redFlagAlert).values({
      episodeId: setup.episodeId,
      kbVersionId: kb?.id ?? '',
      ruleKey: 'test.night_pain',
      name: 'Night pain',
      triage: 'urgent_medical_referral',
      display: 'review',
      action: 'Review today.',
      signedOff: true,
    });
    return setup;
  }

  it('is read by clinicians at any centre, the Super Admin without the tick included', async () => {
    await rolledBack(async (tx) => {
      const { elsewhere, patientId, consultationId, episodeId, appointmentId } =
        await signedAtHsr(tx);
      for (const reader of [elsewhere, superAdmin]) {
        await becomeStaff(tx, reader);
        const [note] = await signedNotesOf(tx, patientId);
        expect(note, reader.email).toMatchObject({
          id: consultationId,
          centreName: 'HSR Layout',
          diagnosis: { conditionId: 'KNE-004', conditionName: 'Patellar Tendinopathy' },
          addenda: [{ text: 'Corrected the side: right knee.' }],
        });
        expect(note?.signedByName, reader.email).toBeTruthy();
        expect(note?.addenda[0]?.authorName, reader.email).toBeTruthy();
        expect((await consultationRecord(tx, consultationId))?.centreName).toBe('HSR Layout');
        const plan = await episodePlan(tx, episodeId);
        expect(plan, reader.email).toMatchObject({
          version: 1,
          sessionsPerWeek: 2,
          homeExercises: 1,
        });
        expect(plan?.treatingPhysioName, reader.email).toBeTruthy();
        expect(await episodePrecautions(tx, episodeId)).toEqual([
          { key: 'pregnancy', label: 'Pregnancy' },
        ]);
        expect(await patientAlertHistory(tx, patientId)).toEqual([
          expect.objectContaining({ name: 'Night pain', status: 'raised', episodeId }),
        ]);
        // The visit behind the note opens too.
        expect(
          await tx
            .select({ id: appointment.id })
            .from(appointment)
            .where(eq(appointment.id, appointmentId)),
        ).toHaveLength(1);
      }
      // The alert list stays with the centres they work at.
      await becomeStaff(tx, elsewhere);
      expect((await openRedFlagAlerts(tx)).map((alert) => alert.episodeId)).not.toContain(
        episodeId,
      );
    });
  });

  it('keeps drafts to the centre', async () => {
    await rolledBack(async (tx) => {
      const { elsewhere, patientId, consultationId } = await setUp(tx);
      await becomeStaff(tx, elsewhere);
      expect(await consultationRecord(tx, consultationId)).toBeUndefined();
      expect(await signedNotesOf(tx, patientId)).toEqual([]);
    });
  });

  it('keeps addenda to the centre, and gives everyone else nothing', async () => {
    await rolledBack(async (tx) => {
      const { elsewhere, patientId, consultationId, episodeId } = await signedAtHsr(tx);
      await becomeStaff(tx, elsewhere);
      expect(
        await failure(tx, (sp) =>
          addAddendum(sp, {
            consultationId,
            episodeId,
            text: 'From Koramangala',
            authorId: elsewhere.id,
          }),
        ),
      ).toBe('42501');
      for (const outsider of [deskHsr, manager, finance, support]) {
        await becomeStaff(tx, outsider);
        expect(await signedNotesOf(tx, patientId), outsider.email).toEqual([]);
        expect(await episodePrecautions(tx, episodeId), outsider.email).toEqual([]);
        expect(await patientAlertHistory(tx, patientId), outsider.email).toEqual([]);
        expect(await episodePlan(tx, episodeId), outsider.email).toBeUndefined();
      }
    });
  });

  it('logs a record view as the clinician, and refuses one for anyone else', async () => {
    await rolledBack(async (tx) => {
      const { elsewhere, patientId } = await setUp(tx);
      await becomeStaff(tx, elsewhere);
      await logClinicalView(tx, 'patient', patientId);
      await asOwner(tx);
      const views = await tx
        .select({ actor: auditEvent.actor, action: auditEvent.action })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.entity, 'patient'),
            eq(auditEvent.entityId, patientId),
            eq(auditEvent.action, 'view'),
          ),
        );
      expect(views).toEqual([{ actor: `staff:${elsewhere.id}`, action: 'view' }]);
      await becomeStaff(tx, deskHsr);
      expect(await failure(tx, (sp) => logClinicalView(sp, 'patient', patientId))).toBe('42501');
    });
  });
});

// ALT-06: signing queues the consultation summary and its message; each addendum the next
// version. The database queues them (staff cannot add jobs), once per event.
describe('the consultation summary', () => {
  const queued = (tx: Tx, consultationId: string) =>
    tx
      .select({ kind: job.kind, key: job.idempotencyKey })
      .from(job)
      .where(sql`${job.payload} ->> 'consultationId' = ${consultationId}`)
      .orderBy(job.idempotencyKey);

  it('is queued on signing and on each addendum, never by staff themselves', async () => {
    await rolledBack(async (tx) => {
      const { consultant, consultationId, episodeId, sign } = await setUp(tx);
      await asOwner(tx);
      expect(await queued(tx, consultationId)).toEqual([]);
      await becomeStaff(tx, consultant);
      expect(await sign()).toBe('signed');
      await asOwner(tx);
      expect(await queued(tx, consultationId)).toEqual([
        {
          kind: 'documents.consultation_summary',
          key: `consultation_summary:sign:${consultationId}`,
        },
        {
          kind: 'whatsapp.consultation_summary',
          key: `whatsapp.consultation_summary:${consultationId}`,
        },
      ]);
      await becomeStaff(tx, consultant);
      const { id: addendumId } = await addAddendum(tx, {
        consultationId,
        episodeId,
        text: 'Seen again',
        authorId: consultant.id,
      });
      // A change after signing (the visit's own updates) queues nothing more.
      expect(
        await failure(tx, (sp) =>
          sp.insert(job).values({ kind: 'documents.consultation_summary', payload: {} }),
        ),
      ).toBe('42501');
      await asOwner(tx);
      expect((await queued(tx, consultationId)).map((row) => row.key)).toEqual([
        `consultation_summary:addendum:${addendumId}`,
        `consultation_summary:sign:${consultationId}`,
        `whatsapp.consultation_summary:${consultationId}`,
      ]);
    });
  });

  it('reads what the summary prints from a signed consultation only', async () => {
    await rolledBack(async (tx) => {
      const { consultant, consultationId, patientId, sign } = await setUp(tx);
      await asOwner(tx);
      expect(await consultationSummaryFacts(tx, consultationId)).toBeUndefined();
      await becomeStaff(tx, consultant);
      expect(await sign()).toBe('signed');
      await asOwner(tx);
      await tx
        .update(staffUser)
        .set({ credentials: 'BPT, MPT (Ortho)' })
        .where(eq(staffUser.id, consultant.id));
      const facts = await consultationSummaryFacts(tx, consultationId);
      expect(facts).toMatchObject({
        patientId,
        centreId: centreIds.hsrLayout,
        signer: { name: consultant.name, credentials: 'BPT, MPT (Ortho)' },
        diagnosis: {
          conditionName: 'Patellar Tendinopathy',
          movement: 'Quad dominance',
          provisional: true,
          categoryName: null,
        },
        plan: {
          sessionsPerWeek: 2,
          weeks: 6,
          reviewDate: '2026-12-05',
          investigations: 'MRI of the right knee if no better in 4 weeks',
          referral: '',
          modalities: ['laser'],
        },
        addenda: [],
      });
    });
  });
});

// CLN-11 and ALT-07: a red flag the consultant finds is an alert they raise on their own draft;
// referring it queues the referral letter and the safety advice; Monitor with caution, the advice.
describe('a red flag found in the consultation', () => {
  const raise = (
    tx: Tx,
    values: { episodeId: string; appointmentId: string; kbVersionId: string },
  ) =>
    insertConsultationRedFlag(tx, {
      ...values,
      name: 'Night pain and weight loss',
      triage: 'urgent_medical_referral',
      display: 'review',
      action: 'Same day physician / orthopaedic / neurosurgical review',
    });
  const kbOf = async (tx: Tx, consultationId: string) =>
    (
      await tx
        .select({ id: consultation.kbVersionId })
        .from(consultation)
        .where(eq(consultation.id, consultationId))
    )[0]?.id ?? '';
  const jobsOf = (tx: Tx, alertId: string) =>
    tx
      .select({ key: job.idempotencyKey })
      .from(job)
      .where(sql`${job.payload} ->> 'alertId' = ${alertId}`)
      .orderBy(job.idempotencyKey);

  it('is raised by the consultant on their own draft only', async () => {
    await rolledBack(async (tx) => {
      const { consultant, colleague, consultationId, episodeId, appointmentId } = await setUp(tx);
      await asOwner(tx);
      const kbVersionId = await kbOf(tx, consultationId);
      const values = { episodeId, appointmentId, kbVersionId };
      for (const outsider of [colleague, deskHsr, superAdmin]) {
        await asOwner(tx);
        await becomeStaff(tx, outsider);
        expect(await failure(tx, (sp) => raise(sp, values)), outsider.email).toBe('42501');
      }
      await asOwner(tx);
      await becomeStaff(tx, consultant);
      // Not with another rule's key, nor already moved on.
      const direct = (extra: Partial<typeof redFlagAlert.$inferInsert>) =>
        failure(tx, (sp) =>
          sp.insert(redFlagAlert).values({
            ...values,
            ruleKey: 'everywhere.night_pain',
            name: 'x',
            triage: 'urgent_medical_referral',
            display: 'review',
            action: 'x',
            signedOff: true,
            ...extra,
          }),
        );
      expect(await direct({})).toBe('42501');
      expect(await direct({ ruleKey: 'consultation.x', status: 'referred' })).toBe('42501');
      expect(await raise(tx, values)).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('queues the referral letter and the safety advice once referred, and reads the letter', async () => {
    await rolledBack(async (tx) => {
      const { consultant, consultationId, episodeId, appointmentId, patientId } = await setUp(tx);
      await asOwner(tx);
      const kbVersionId = await kbOf(tx, consultationId);
      await becomeStaff(tx, consultant);
      const alertId = await raise(tx, { episodeId, appointmentId, kbVersionId });
      await moveRedFlagAlert(tx, alertId, 'raised', {
        status: 'reviewed',
        reviewedBy: consultant.id,
      });
      await asOwner(tx);
      expect(await jobsOf(tx, alertId)).toEqual([]);
      expect(await referralLetterFacts(tx, alertId)).toBeUndefined();
      await becomeStaff(tx, consultant);
      await moveRedFlagAlert(tx, alertId, 'reviewed', {
        status: 'referred',
        referredBy: consultant.id,
        referredTo: 'Orthopaedic surgeon',
        referralReason: 'Night pain and weight loss over 6 weeks',
        referralQuestion: 'Please rule out a bony lesion.',
      });
      await asOwner(tx);
      expect((await jobsOf(tx, alertId)).map((row) => row.key)).toEqual([
        `referral_letter:${alertId}`,
        `whatsapp.red_flag_safety_advice:${alertId}`,
      ]);
      expect(await referralLetterFacts(tx, alertId)).toMatchObject({
        patientId,
        episodeId,
        referral: {
          found: 'Night pain and weight loss',
          triage: 'urgent_medical_referral',
          referredTo: 'Orthopaedic surgeon',
          question: 'Please rule out a bony lesion.',
        },
        referrer: { name: consultant.name },
        completedVisits: [],
      });
    });
  });

  it('queues only the safety advice for Monitor with caution', async () => {
    await rolledBack(async (tx) => {
      const { consultant, consultationId, episodeId, appointmentId } = await setUp(tx);
      await asOwner(tx);
      const kbVersionId = await kbOf(tx, consultationId);
      await becomeStaff(tx, consultant);
      const alertId = await insertConsultationRedFlag(tx, {
        episodeId,
        appointmentId,
        kbVersionId,
        name: 'Mild night pain',
        triage: 'monitor_with_caution',
        display: 'information',
        action: 'Reassess frequently; safety-net patient in writing',
      });
      await moveRedFlagAlert(tx, alertId, 'raised', {
        status: 'reviewed',
        reviewedBy: consultant.id,
      });
      await asOwner(tx);
      expect((await jobsOf(tx, alertId)).map((row) => row.key)).toEqual([
        `whatsapp.red_flag_safety_advice:${alertId}`,
      ]);
    });
  });
});

// BIL-01: the front desk prices the plan without clinical access: only what pricing needs, to those
// who see bill amounts, the desk at the episode's centre only.
describe('the plan for pricing', () => {
  it('gives the desk at its centre, Finance and the Super Admin the plan, and nobody else', async () => {
    await rolledBack(async (tx) => {
      const { consultant, episodeId, sign } = await setUp(tx);
      expect(await sign()).toBe('signed');
      const reads = async (actor: StaffMember) => {
        await asOwner(tx);
        await becomeStaff(tx, actor);
        return planForPricing(tx, episodeId);
      };
      const plan = await reads(deskHsr);
      expect(plan?.planOfCareId).toMatch(/^[0-9a-f-]{36}$/);
      expect({ ...plan, planOfCareId: undefined }).toEqual({
        planOfCareId: undefined,
        sessionsPerWeek: 2,
        weeks: 6,
        reviewDate: '2026-12-05',
        treatingPhysio: consultant.name,
        modalities: [{ key: 'laser', name: 'laser' }],
      });
      expect(await reads(finance), 'finance').toBeDefined();
      expect(await reads(superAdmin), 'super admin').toBeDefined();
      for (const outsider of [deskKoramangala, manager, consultant]) {
        expect(await reads(outsider), outsider.email).toBeUndefined();
      }
    });
  });
});

// BIL-02: the patient's choice on the plan, read and recorded by those who price it, only while
// the episode is Plan proposed and against its newest plan; "I'll think about it" is followed up at
// 10:00 AM IST on the second day with a call task and the WhatsApp nudge, unless chosen since.
describe('the patient choice', () => {
  /** A signed consultation whose episode is Plan proposed, and its plan of care. */
  async function proposed(tx: Tx) {
    const fixture = await setUp(tx);
    expect(await fixture.sign()).toBe('signed');
    await asOwner(tx);
    for (const status of ['awaiting_consultation', 'plan_proposed'] as const) {
      await tx.update(episode).set({ status }).where(eq(episode.id, fixture.episodeId));
    }
    const [plan] = await tx
      .select({ id: planOfCare.id })
      .from(planOfCare)
      .where(eq(planOfCare.episodeId, fixture.episodeId));
    return { ...fixture, planOfCareId: plan?.id ?? '' };
  }

  type ChoiceValues = Omit<Parameters<typeof recordPlanChoice>[1], 'recordedBy'> & {
    recordedBy?: string;
  };

  const record = async (tx: Tx, actor: StaffMember, values: ChoiceValues) => {
    await asOwner(tx);
    await becomeStaff(tx, actor);
    return recordPlanChoice(tx, { recordedBy: actor.id, ...values });
  };

  it('is recorded by the desk at its centre, with the follow up queued for day 2 at 10:00 AM IST', async () => {
    await rolledBack(async (tx) => {
      const { episodeId, planOfCareId } = await proposed(tx);
      const choice = await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'think_about_it',
      });
      expect(choice.followUpAt).toEqual(istInstant(addDays(istDate(new Date()), 2), 10 * 60));
      await asOwner(tx);
      const queued = await tx
        .select({ runAt: job.runAt, payload: job.payload })
        .from(job)
        .where(eq(job.idempotencyKey, `billing.think_about_it_follow_up:${choice.id}`));
      expect(queued).toEqual([{ runAt: choice.followUpAt, payload: { choiceId: choice.id } }]);

      const reads = async (actor: StaffMember) => {
        await asOwner(tx);
        await becomeStaff(tx, actor);
        return (await planChoicesOf(tx, episodeId)).map((entry) => entry.choice);
      };
      for (const reader of [deskHsr, finance, superAdmin]) {
        expect(await reads(reader), reader.email).toEqual(['think_about_it']);
      }
      for (const outsider of [deskKoramangala, manager]) {
        expect(await reads(outsider), outsider.email).toEqual([]);
      }
    });
  });

  it('is refused at another centre, as someone else, by support, when not proposed, and never changed', async () => {
    await rolledBack(async (tx) => {
      const { consultant, episodeId, planOfCareId } = await proposed(tx);
      const values: ChoiceValues = { episodeId, planOfCareId, choice: 'no_thanks' };
      const refused = (actor: StaffMember, extra: Partial<ChoiceValues> = {}) =>
        failure(tx, (sp) => record(sp, actor, { ...values, ...extra }));
      expect(await refused(deskKoramangala), 'other centre').toBe('42501');
      expect(await refused(manager), 'manager').toBe('42501');
      expect(await refused(consultant), 'physio').toBe('42501');
      expect(await refused(support), 'support').toBeDefined();
      expect(await refused(deskHsr, { recordedBy: finance.id }), 'as someone else').toBe('42501');
      expect(
        await refused(deskHsr, { planOfCareId: '00000000-0000-4000-8000-000000000000' }),
        'not its plan',
      ).toBe('42501');

      const choice = await record(tx, deskHsr, values);
      expect(
        await failure(tx, (sp) =>
          sp.execute(sql`update plan_choice set choice = 'package' where id = ${choice.id}`),
        ),
        'update',
      ).toBe('42501');
      expect(
        await failure(tx, (sp) => sp.execute(sql`delete from plan_choice where id = ${choice.id}`)),
        'delete',
      ).toBe('42501');

      await asOwner(tx);
      await tx.update(episode).set({ status: 'active' }).where(eq(episode.id, episodeId));
      expect(await refused(deskHsr), 'active').toBe('42501');
    });
  });

  it('raises the call task and the nudge once, and nothing after a newer choice or once the episode moves on', async () => {
    await rolledBack(async (tx) => {
      const { episodeId, planOfCareId, patientId } = await proposed(tx);
      const thinking = await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'think_about_it',
      });
      await asOwner(tx);
      expect(await thinkAboutItFollowUp(tx, thinking.id)).toBe('raised');
      expect(await thinkAboutItFollowUp(tx, thinking.id)).toBe('already raised');
      const raised = await tx
        .select({
          title: task.title,
          role: task.assigneeRole,
          centreId: task.centreId,
          patientId: task.patientId,
        })
        .from(task)
        .where(sql`${task.details} ->> 'choiceId' = ${thinking.id}`);
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        role: 'front_desk',
        centreId: centreIds.hsrLayout,
        patientId,
      });
      expect(raised[0]?.title).toMatch(
        /^Call about the proposed plan \(thinking it over since \w{3} \d{1,2} \w{3}\)$/,
      );
      const nudges = await tx
        .select({ id: job.id })
        .from(job)
        .where(eq(job.idempotencyKey, `whatsapp.think_about_it:${thinking.id}`));
      expect(nudges).toHaveLength(1);

      // Chosen since: nothing.
      const again = await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'think_about_it',
      });
      await asOwner(tx);
      const [session] = await tx
        .select({ id: priceItem.id })
        .from(priceItem)
        .where(eq(priceItem.key, 'rehabilitation_session'));
      await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'per_session',
        sessionPriceItemId: session?.id ?? '',
      });
      await asOwner(tx);
      expect(await thinkAboutItFollowUp(tx, again.id), 'chosen since').toBe('no longer thinking');

      // The episode moved on: nothing.
      const last = await record(tx, deskHsr, { episodeId, planOfCareId, choice: 'think_about_it' });
      await asOwner(tx);
      await tx.update(episode).set({ status: 'active' }).where(eq(episode.id, episodeId));
      expect(await thinkAboutItFollowUp(tx, last.id), 'active').toBe('no longer thinking');
    });
  });
});
