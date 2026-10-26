import {
  addDays,
  earlierToday,
  istDate,
  istInstant,
  packageValidUntil,
  type SignedRows,
} from '@clinic-mx/schemas';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  billsOfEpisode,
  consultationBillNow,
  consultationFeeState,
  recordPayment,
  undoPayment,
} from '../bills';
import { addAddendum, consultationAddenda, signConsultation } from '../clinical-record';
import { invoiceFacts } from '../invoice';
import { packageRescheduleState, packagesOfEpisode, usePackageSession } from '../packages';
import { latestKnowledgeVersion } from '../knowledge';
import {
  addSessionAddendum,
  lastSignedSessionNote,
  openSession,
  saveSessionNote,
  sessionAddenda,
  sessionNoteOf,
  sessionProgress,
  signSession,
} from '../sessions';
import { changeAppointment, checkIn, undoCheckIn } from '../slots';
import { consultationSummaryFacts } from '../consultation-summary';
import { consultationRecord, openConsultation } from '../consultations';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { sessionVisit, startVisit } from '../my-patients';
import {
  episodePlan,
  episodePrecautions,
  logClinicalView,
  patientAlertHistory,
  signedNotesOf,
  signedSessionNotesOf,
} from '../patient-record';
import { insertConsultationRedFlag, moveRedFlagAlert, openRedFlagAlerts } from '../red-flag-alerts';
import { planChoicesOf, recordPlanChoice, thinkAboutItFollowUp } from '../plan-choice';
import { planForPricing } from '../plan-sheet';
import { referralLetterFacts } from '../referral-letter';
import {
  addendum,
  appointment,
  auditEvent,
  bill,
  billLine,
  consultation,
  payment,
  diagnosis,
  episode,
  job,
  kbCondition,
  measure,
  packageType,
  packageTypeItem,
  patientPackage,
  planModality,
  planOfCare,
  precaution,
  priceItem,
  redFlagAlert,
  specialTestResult,
  staffUser,
  task,
  treatmentSession,
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
const physioHsr = member('physio.hsr@clinicmx.test');
/** A Super Admin without the Treats patients tick. */
const adminWithoutTick = member('admin.phone@clinicmx.test');

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
  const startsAt = earlierToday(5);
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

const feeFor = async (tx: Tx, staffId: string, key: string | null) => {
  await asOwner(tx);
  await tx.execute(
    sql`update staff_user set consultation_price_item_id =
      (select id from price_item where key = ${key}) where id = ${staffId}`,
  );
};

// BIL-02: the patient's choice on the plan, read and recorded by those who price it, only while
// the episode is Plan proposed and against its newest plan; "I'll think about it" is followed up at
// 10:00 AM IST on the second day with a call task and the WhatsApp nudge, unless chosen since.
describe('the patient choice', () => {
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

  it('bills a chosen package at its price, and a later choice cancels that bill', async () => {
    await rolledBack(async (tx) => {
      const { episodeId, planOfCareId } = await proposed(tx);
      const [session] = await tx
        .select({ id: priceItem.id })
        .from(priceItem)
        .where(eq(priceItem.key, 'rehabilitation_session'));
      const [offer] = await tx
        .insert(packageType)
        .values({ name: 'Test Ten sessions', sessions: 10, pricePaise: 900000 })
        .returning({ id: packageType.id });
      await tx
        .insert(packageTypeItem)
        .values({ packageTypeId: offer?.id ?? '', priceItemId: session?.id ?? '' });
      await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'package',
        packageTypeId: offer?.id ?? '',
        sessionPriceItemId: session?.id ?? '',
      });
      await asOwner(tx);
      const [made] = await billsOfEpisode(tx, episodeId);
      expect(made).toMatchObject({ kind: 'package', status: 'unpaid', totalPaise: 900000 });
      expect(made?.number).toMatch(/^HSR-B-\d{5}$/);
      expect(made?.lines).toEqual([
        { description: 'Test Ten sessions', quantity: 1, unitPaise: 900000, amountPaise: 900000 },
      ]);

      await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'per_session',
        sessionPriceItemId: session?.id ?? '',
      });
      await asOwner(tx);
      expect(await billsOfEpisode(tx, episodeId)).toMatchObject([
        { kind: 'package', status: 'cancelled', cancelReason: 'The patient chose differently.' },
      ]);
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

// BIL-05: the database bills the consultation fee at the consultant's own fee when the timing
// setting says, once per visit; nobody signed in writes a bill, and only those who see amounts at
// the centre read one.
describe('bills at fixed prices', () => {
  const visitBills = async (tx: Tx, appointmentId: string) => {
    await asOwner(tx);
    return tx
      .select({
        id: bill.id,
        number: bill.number,
        status: bill.status,
        total: bill.totalPaise,
        createdBy: bill.createdBy,
        cancelReason: bill.cancelReason,
      })
      .from(bill)
      .where(eq(bill.appointmentId, appointmentId));
  };

  /** Another visit for the fixture's patient, inserted as it stands. */
  const visit = async (
    tx: Tx,
    fixture: Awaited<ReturnType<typeof setUp>>,
    typeKey: string,
    status: 'checked_in' | 'completed',
  ) => {
    await asOwner(tx);
    const startsAt = earlierToday(30);
    const [row] = await tx
      .insert(appointment)
      .values({
        number: '',
        patientId: fixture.patientId,
        centreId: centreIds.hsrLayout,
        physioId: fixture.consultant.id,
        appointmentTypeId: await typeId(tx, typeKey),
        episodeId: fixture.episodeId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60000),
        channel: 'front_desk',
        bookedBy: superAdmin.id,
        status,
        arrivedAt: new Date(),
        checkedInBy: deskHsr.id,
        ...(status === 'completed' ? { completedAt: new Date() } : {}),
      })
      .returning({ id: appointment.id });
    return row?.id ?? '';
  };

  it('bills the consultant’s own fee when the consultation completes, once, numbered by the centre', async () => {
    await rolledBack(async (tx) => {
      const first = await setUp(tx);
      await feeFor(tx, first.consultant.id, 'consultation');
      await becomeStaff(tx, first.consultant);
      expect(await first.sign()).toBe('signed');
      const [made, ...more] = await visitBills(tx, first.appointmentId);
      expect(more).toEqual([]);
      expect(made).toMatchObject({
        status: 'unpaid',
        total: 75000,
        createdBy: first.consultant.id,
      });
      expect(made?.number).toMatch(/^HSR-B-\d{5}$/);
      const lines = await tx
        .select({ description: billLine.description, amount: billLine.amountPaise })
        .from(billLine)
        .where(eq(billLine.billId, made?.id ?? ''));
      expect(lines).toEqual([{ description: 'Consultation', amount: 75000 }]);
      // Again: the same bill, no second one.
      const [again] = await tx.execute<{ id: string }>(
        sql`select internal.make_consultation_bill(${first.appointmentId}::uuid) as id`,
      );
      expect(again?.id).toBe(made?.id);
      expect(await visitBills(tx, first.appointmentId)).toHaveLength(1);

      // A senior consultant's fee, and the next number.
      const second = await setUp(tx);
      await feeFor(tx, second.consultant.id, 'senior_consultation');
      await becomeStaff(tx, second.consultant);
      expect(await second.sign()).toBe('signed');
      const [senior] = await visitBills(tx, second.appointmentId);
      expect(senior?.total).toBe(100000);
      const numberOf = (value: string | undefined) => Number(value?.slice(-5));
      expect(numberOf(senior?.number)).toBe(numberOf(made?.number) + 1);
    });
  });

  it('bills nothing but a consultation', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await feeFor(tx, fixture.consultant.id, 'consultation');
      const session = await visit(tx, fixture, 'session', 'completed');
      expect(await visitBills(tx, session)).toEqual([]);
    });
  });

  it('bills at check in when the setting says, and undoing the check in cancels it', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await feeFor(tx, fixture.consultant.id, 'consultation');
      await tx.execute(
        sql`update setting set value = '"at_check_in"'::jsonb
          where key = 'billing.consultation_fee_timing'`,
      );
      const walkIn = await visit(tx, fixture, 'consultation', 'checked_in');
      expect(await visitBills(tx, walkIn)).toMatchObject([{ status: 'unpaid', total: 75000 }]);
      await becomeStaff(tx, deskHsr);
      await tx
        .update(appointment)
        .set({ status: 'booked', arrivedAt: null, checkedInBy: null })
        .where(eq(appointment.id, walkIn));
      expect(await visitBills(tx, walkIn)).toMatchObject([
        { status: 'cancelled', cancelReason: 'Check in was undone.' },
      ]);
    });
  });

  it('bills nothing without a fee; once it is set, the desk at the centre makes the bill', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await feeFor(tx, fixture.consultant.id, null);
      await becomeStaff(tx, fixture.consultant);
      expect(await fixture.sign()).toBe('signed');
      expect(await visitBills(tx, fixture.appointmentId)).toEqual([]);
      await becomeStaff(tx, deskHsr);
      expect(await consultationFeeState(tx, fixture.episodeId)).toMatchObject({
        appointmentId: fixture.appointmentId,
        status: 'completed',
        consultantName: fixture.consultant.name,
        feeLabel: null,
        billed: false,
      });

      await feeFor(tx, fixture.consultant.id, 'consultation');
      await becomeStaff(tx, deskKoramangala);
      expect(
        await failure(tx, (sp) => consultationBillNow(sp, fixture.appointmentId)),
        'another centre',
      ).toBe('42501');
      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      const made = await consultationBillNow(tx, fixture.appointmentId);
      expect(made).toMatch(/^[0-9a-f-]{36}$/);
      expect(await consultationBillNow(tx, fixture.appointmentId)).toBe(made);
      expect(await visitBills(tx, fixture.appointmentId)).toHaveLength(1);
    });
  });

  it('is read by those who see amounts at the centre and written by nobody signed in', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await feeFor(tx, fixture.consultant.id, 'consultation');
      await becomeStaff(tx, fixture.consultant);
      expect(await fixture.sign()).toBe('signed');
      const [made] = await visitBills(tx, fixture.appointmentId);
      const reads = async (actor: StaffMember) => {
        await asOwner(tx);
        await becomeStaff(tx, actor);
        return (await billsOfEpisode(tx, fixture.episodeId)).length;
      };
      for (const reader of [deskHsr, finance, superAdmin]) {
        expect(await reads(reader), reader.email).toBe(1);
      }
      for (const outsider of [deskKoramangala, manager, fixture.consultant]) {
        expect(await reads(outsider), outsider.email).toBe(0);
      }

      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      const id = made?.id ?? '';
      for (const [name, statement] of [
        ['change the total', sql`update bill set total_paise = 100 where id = ${id}`],
        ['change a line', sql`update bill_line set unit_paise = 100 where bill_id = ${id}`],
        ['delete', sql`delete from bill where id = ${id}`],
        [
          'add',
          sql`insert into bill (number, kind, patient_id, centre_id, appointment_id, total_paise)
            values ('HSR-B-99999', 'consultation', ${fixture.patientId}, ${centreIds.hsrLayout},
              ${fixture.appointmentId}, 1)`,
        ],
      ] as const) {
        expect(await failure(tx, (sp) => sp.execute(statement)), name).toBe('42501');
      }
    });
  });
});

// BIL-06: the desk marks a bill paid for its whole total by UPI QR, card or cash; the chosen
// plan paid moves the episode to Active; a mistake is undone on its day by the desk at the centre.
describe('counter payments', () => {
  /** A Plan proposed episode whose consultant charges the Consultation fee, billed on signing. */
  async function billed(tx: Tx) {
    const fixture = await setUp(tx);
    await feeFor(tx, fixture.consultant.id, 'consultation');
    await becomeStaff(tx, fixture.consultant);
    expect(await fixture.sign()).toBe('signed');
    await asOwner(tx);
    for (const status of ['awaiting_consultation', 'plan_proposed'] as const) {
      await tx.update(episode).set({ status }).where(eq(episode.id, fixture.episodeId));
    }
    const [plan] = await tx
      .select({ id: planOfCare.id })
      .from(planOfCare)
      .where(eq(planOfCare.episodeId, fixture.episodeId));
    const [fee] = await tx
      .select({ id: bill.id })
      .from(bill)
      .where(eq(bill.appointmentId, fixture.appointmentId));
    const [session] = await tx
      .select({ id: priceItem.id })
      .from(priceItem)
      .where(eq(priceItem.key, 'rehabilitation_session'));
    return {
      ...fixture,
      planOfCareId: plan?.id ?? '',
      feeBillId: fee?.id ?? '',
      sessionId: session?.id ?? '',
    };
  }

  const pay = async (tx: Tx, actor: StaffMember, billId: string, reference?: string) => {
    await asOwner(tx);
    await becomeStaff(tx, actor);
    return recordPayment(tx, { billId, method: 'upi', reference });
  };

  const statusOf = async (tx: Tx, episodeId: string) => {
    await asOwner(tx);
    const [row] = await tx
      .select({ status: episode.status })
      .from(episode)
      .where(eq(episode.id, episodeId));
    return row?.status;
  };

  it('records the whole total as the desk, once, and nobody else at all', async () => {
    await rolledBack(async (tx) => {
      const { consultant, feeBillId } = await billed(tx);
      for (const outsider of [deskKoramangala, manager, consultant]) {
        expect(await failure(tx, (sp) => pay(sp, outsider, feeBillId)), outsider.email).toBe(
          '42501',
        );
      }
      expect(await failure(tx, (sp) => pay(sp, support, feeBillId)), 'support').toBeDefined();
      const paid = await pay(tx, deskHsr, feeBillId, '  UPI-4528  ');
      await asOwner(tx);
      const [row] = await tx
        .select({
          amount: payment.amountPaise,
          reference: payment.reference,
          by: payment.recordedBy,
          method: payment.method,
        })
        .from(payment)
        .where(eq(payment.id, paid));
      expect(row).toEqual({ amount: 75000, reference: 'UPI-4528', by: deskHsr.id, method: 'upi' });
      const [after] = await tx
        .select({ status: bill.status })
        .from(bill)
        .where(eq(bill.id, feeBillId));
      expect(after?.status).toBe('paid');
      expect(await failure(tx, (sp) => pay(sp, deskHsr, feeBillId)), 'twice').toBe('23514');
      await becomeStaff(tx, deskHsr);
      for (const [name, statement] of [
        [
          'insert',
          sql`insert into payment (bill_id, method, amount_paise, recorded_by)
            values (${feeBillId}, 'cash', 1, ${deskHsr.id})`,
        ],
        ['update', sql`update payment set amount_paise = 1 where id = ${paid}`],
        ['delete', sql`delete from payment where id = ${paid}`],
      ] as const) {
        expect(await failure(tx, (sp) => sp.execute(statement)), name).toBe('42501');
      }
    });
  });

  it('moves the episode to Active once the chosen plan is paid, and not otherwise', async () => {
    // Pay per session chosen, then the fee paid.
    await rolledBack(async (tx) => {
      const { episodeId, planOfCareId, feeBillId, sessionId } = await billed(tx);
      await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'per_session',
        sessionPriceItemId: sessionId,
      });
      await pay(tx, deskHsr, feeBillId);
      expect(await statusOf(tx, episodeId)).toBe('active');
    });
    // The fee paid, then pay per session chosen.
    await rolledBack(async (tx) => {
      const { episodeId, planOfCareId, feeBillId, sessionId } = await billed(tx);
      await pay(tx, deskHsr, feeBillId);
      expect(await statusOf(tx, episodeId)).toBe('plan_proposed');
      await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'per_session',
        sessionPriceItemId: sessionId,
      });
      expect(await statusOf(tx, episodeId)).toBe('active');
    });
    // Thinking about it: the fee paid changes nothing.
    await rolledBack(async (tx) => {
      const { episodeId, planOfCareId, feeBillId } = await billed(tx);
      await record(tx, deskHsr, { episodeId, planOfCareId, choice: 'think_about_it' });
      await pay(tx, deskHsr, feeBillId);
      expect(await statusOf(tx, episodeId)).toBe('plan_proposed');
    });
    // A package: its bill paid, not the fee.
    await rolledBack(async (tx) => {
      const { episodeId, planOfCareId, feeBillId, sessionId } = await billed(tx);
      const [offer] = await tx
        .insert(packageType)
        .values({ name: 'Test Ten sessions', sessions: 10, pricePaise: 900000 })
        .returning({ id: packageType.id });
      await tx
        .insert(packageTypeItem)
        .values({ packageTypeId: offer?.id ?? '', priceItemId: sessionId });
      await record(tx, deskHsr, {
        episodeId,
        planOfCareId,
        choice: 'package',
        packageTypeId: offer?.id ?? '',
        sessionPriceItemId: sessionId,
      });
      await pay(tx, deskHsr, feeBillId);
      expect(await statusOf(tx, episodeId)).toBe('plan_proposed');
      await asOwner(tx);
      const [packageBill] = await tx
        .select({ id: bill.id })
        .from(bill)
        .where(and(eq(bill.episodeId, episodeId), eq(bill.kind, 'package')));
      await pay(tx, deskHsr, packageBill?.id ?? '');
      expect(await statusOf(tx, episodeId)).toBe('active');
    });
  });

  it('numbers each payment’s invoice in the centre’s own series and queues its PDF and receipt', async () => {
    await rolledBack(async (tx) => {
      const first = await billed(tx);
      const second = await billed(tx);
      const one = await pay(tx, deskHsr, first.feeBillId, 'UPI-1');
      const two = await pay(tx, deskHsr, second.feeBillId);
      await asOwner(tx);
      const numbers = await tx
        .select({ id: payment.id, invoice: payment.invoiceNumber })
        .from(payment)
        .where(inArray(payment.id, [one, two]));
      const invoiceOf = (id: string) => numbers.find((row) => row.id === id)?.invoice ?? '';
      expect(invoiceOf(one)).toMatch(/^HSR-INV-\d{5}$/);
      expect(Number(invoiceOf(two).slice(-5))).toBe(Number(invoiceOf(one).slice(-5)) + 1);
      const queued = async (paymentId: string) =>
        (
          await tx
            .select({ kind: job.kind, key: job.idempotencyKey })
            .from(job)
            .where(sql`${job.payload} ->> 'paymentId' = ${paymentId}`)
        )
          .map((row) => [row.kind, row.key].join(' '))
          .sort();
      expect(await queued(one)).toEqual([
        `documents.invoice invoice:${one}`,
        `whatsapp.receipt receipt:${one}`,
      ]);

      expect(await invoiceFacts(tx, one)).toMatchObject({
        invoiceNumber: invoiceOf(one),
        billKind: 'consultation',
        centreId: centreIds.hsrLayout,
        lines: [{ description: 'Consultation', quantity: 1, unitPaise: 75000, amountPaise: 75000 }],
        totalPaise: 75000,
        method: 'upi',
        reference: 'UPI-1',
        receivedBy: deskHsr.name,
        package: null,
        undone: null,
      });

      // Undone: the invoice is queued again (printed cancelled); paying again gets a new number.
      await becomeStaff(tx, deskHsr);
      await undoPayment(tx, { paymentId: one, reason: 'Wrong patient' });
      await asOwner(tx);
      expect(await queued(one)).toEqual([
        `documents.invoice invoice:${one}`,
        `documents.invoice invoice:undo:${one}`,
        `whatsapp.receipt receipt:${one}`,
      ]);
      expect((await invoiceFacts(tx, one))?.undone?.reason).toBe('Wrong patient');
      const again = await pay(tx, deskHsr, first.feeBillId);
      await asOwner(tx);
      const [fresh] = await tx
        .select({ invoice: payment.invoiceNumber })
        .from(payment)
        .where(eq(payment.id, again));
      expect(Number(fresh?.invoice?.slice(-5))).toBe(Number(invoiceOf(two).slice(-5)) + 1);
    });
  });

  it('is undone on its day by the desk at the centre, with a reason, and not after', async () => {
    await rolledBack(async (tx) => {
      const { feeBillId } = await billed(tx);
      const paid = await pay(tx, deskHsr, feeBillId);
      const undo = (actor: StaffMember, paymentId: string, reason = 'Wrong patient') =>
        failure(tx, async (sp) => {
          await asOwner(sp);
          await becomeStaff(sp, actor);
          await undoPayment(sp, { paymentId, reason });
        });
      expect(await undo(deskKoramangala, paid), 'another centre').toBe('42501');
      expect(await undo(deskHsr, paid, ' '), 'no reason').toBe('23514');
      expect(await undo(deskHsr, paid), 'the desk').toBeUndefined();
      await asOwner(tx);
      const [back] = await tx
        .select({ status: bill.status })
        .from(bill)
        .where(eq(bill.id, feeBillId));
      expect(back?.status).toBe('unpaid');

      // Paid again, then yesterday's payment: Finance's refund, not the desk's undo.
      const again = await pay(tx, deskHsr, feeBillId);
      await asOwner(tx);
      await tx
        .update(payment)
        .set({ recordedAt: new Date(Date.now() - 24 * 60 * 60_000) })
        .where(eq(payment.id, again));
      expect(await undo(deskHsr, again), 'yesterday').toBe('23514');
    });
  });

  // BIL-08: paying a package's bill activates the package; a session is used only while it is
  // active; undoing the payment cancels it while no session has been used.
  async function chosenPackage(tx: Tx, sessions = 12) {
    const fixture = await billed(tx);
    await asOwner(tx);
    const [offer] = await tx
      .insert(packageType)
      .values({ name: `Test ${String(sessions)} sessions`, sessions, pricePaise: 900000 })
      .returning({ id: packageType.id });
    await tx
      .insert(packageTypeItem)
      .values({ packageTypeId: offer?.id ?? '', priceItemId: fixture.sessionId });
    await record(tx, deskHsr, {
      episodeId: fixture.episodeId,
      planOfCareId: fixture.planOfCareId,
      choice: 'package',
      packageTypeId: offer?.id ?? '',
      sessionPriceItemId: fixture.sessionId,
    });
    await asOwner(tx);
    const [packageBill] = await tx
      .select({ id: bill.id })
      .from(bill)
      .where(and(eq(bill.episodeId, fixture.episodeId), eq(bill.kind, 'package')));
    return { ...fixture, packageTypeId: offer?.id ?? '', packageBillId: packageBill?.id ?? '' };
  }

  const packageOf = async (tx: Tx, paymentId: string) => {
    await asOwner(tx);
    const [row] = await tx
      .select()
      .from(patientPackage)
      .where(eq(patientPackage.paymentId, paymentId));
    return row;
  };

  it('activates the package its bill buys, valid to the month’s end, with its reminder', async () => {
    await rolledBack(async (tx) => {
      const { episodeId, patientId, packageBillId, feeBillId } = await chosenPackage(tx, 12);
      const fee = await pay(tx, deskHsr, feeBillId);
      expect(await packageOf(tx, fee), 'the fee buys none').toBeUndefined();
      const paid = await pay(tx, deskHsr, packageBillId);
      const bought = await packageOf(tx, paid);
      expect(bought).toMatchObject({
        patientId,
        episodeId,
        centreId: centreIds.hsrLayout,
        billId: packageBillId,
        name: 'Test 12 sessions',
        sessionsTotal: 12,
        sessionsUsed: 0,
        reschedulesLeft: 1,
        cancelledAt: null,
      });
      expect(bought?.validUntil).toBe(packageValidUntil(bought?.paidAt ?? new Date(), 3));
      const [reminder] = await tx
        .select({ kind: job.kind, runAt: job.runAt, key: job.idempotencyKey })
        .from(job)
        .where(sql`${job.payload} ->> 'packageId' = ${bought?.id ?? ''}`);
      expect(reminder).toEqual({
        kind: 'whatsapp.package_expiry_reminder',
        runAt: istInstant(addDays(bought?.validUntil ?? '', -14), 600),
        key: `package_expiry:${bought?.id ?? ''}`,
      });

      // Paid on 30 November: valid until 28 February, reminded on 14 February at 10:00 AM IST.
      await tx.delete(patientPackage).where(eq(patientPackage.paymentId, paid));
      await tx
        .update(payment)
        .set({ recordedAt: new Date('2026-11-30T10:35:00Z') })
        .where(eq(payment.id, paid));
      await tx.execute(sql`select internal.activate_package(${paid}::uuid)`);
      const late = await packageOf(tx, paid);
      expect(late?.validUntil).toBe('2027-02-28');
      const [lateReminder] = await tx
        .select({ runAt: job.runAt })
        .from(job)
        .where(sql`${job.payload} ->> 'packageId' = ${late?.id ?? ''}`);
      expect(lateReminder?.runAt).toEqual(new Date('2027-02-14T04:30:00Z'));
    });
  });

  it('uses a session only while the package is active, as the system only', async () => {
    await rolledBack(async (tx) => {
      const { packageBillId, episodeId } = await chosenPackage(tx, 2);
      const paid = await pay(tx, deskHsr, packageBillId);
      const bought = await packageOf(tx, paid);
      const id = bought?.id ?? '';
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, deskHsr);
          await usePackageSession(sp, id);
        }),
        'the desk',
      ).toBe('42501');
      await asOwner(tx);
      const use = () => failure(tx, (sp) => usePackageSession(sp, id));
      await tx
        .update(patientPackage)
        .set({ validUntil: addDays(istDate(new Date()), -1) })
        .where(eq(patientPackage.id, id));
      expect(await use(), 'expired').toBe('23514');
      await tx
        .update(patientPackage)
        .set({ validUntil: istDate(new Date()) })
        .where(eq(patientPackage.id, id));
      expect(await usePackageSession(tx, id), 'its last day').toBe(1);
      expect(await usePackageSession(tx, id)).toBe(0);
      expect(await use(), 'used up').toBe('23514');
      const [entry] = await packagesOfEpisode(tx, episodeId);
      expect(entry).toMatchObject({ sessionsUsed: 2, sessionsLeft: 0, state: 'used_up' });
      await tx
        .update(patientPackage)
        .set({ sessionsUsed: 0, cancelledAt: new Date(), cancelReason: 'Test' })
        .where(eq(patientPackage.id, id));
      expect(await use(), 'cancelled').toBe('23514');
    });
  });

  it('is cancelled by undoing its payment, refused once a session is used', async () => {
    await rolledBack(async (tx) => {
      const { packageBillId } = await chosenPackage(tx);
      const first = await pay(tx, deskHsr, packageBillId);
      await becomeStaff(tx, deskHsr);
      await undoPayment(tx, { paymentId: first, reason: 'Wrong package' });
      expect(await packageOf(tx, first)).toMatchObject({
        cancelReason: 'The payment was undone.',
      });
      expect((await packageOf(tx, first))?.cancelledAt).not.toBeNull();

      // Paid again: a fresh package; once a session is used the desk cannot undo it.
      const second = await pay(tx, deskHsr, packageBillId);
      const fresh = await packageOf(tx, second);
      expect(fresh?.cancelledAt).toBeNull();
      await usePackageSession(tx, fresh?.id ?? '');
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, deskHsr);
          await undoPayment(sp, { paymentId: second, reason: 'Wrong package' });
        }),
      ).toBe('23514');
      expect((await packageOf(tx, second))?.cancelledAt).toBeNull();
    });
  });

  it('is read by those who see amounts at its centre and its physios, written by nobody', async () => {
    await rolledBack(async (tx) => {
      const { packageBillId, consultant, elsewhere } = await chosenPackage(tx);
      const paid = await pay(tx, deskHsr, packageBillId);
      const id = (await packageOf(tx, paid))?.id ?? '';
      const reads = async (actor: StaffMember) => {
        await asOwner(tx);
        await becomeStaff(tx, actor);
        const [row] = await tx
          .select({ id: patientPackage.id })
          .from(patientPackage)
          .where(eq(patientPackage.id, id));
        return row?.id;
      };
      for (const reader of [deskHsr, finance, superAdmin, consultant]) {
        expect(await reads(reader), reader.email).toBe(id);
      }
      for (const outsider of [deskKoramangala, manager, elsewhere]) {
        expect(await reads(outsider), outsider.email).toBeUndefined();
      }
      await asOwner(tx);
      await becomeStaff(tx, finance);
      for (const [name, statement] of [
        ['update', sql`update package set sessions_used = 0 where id = ${id}`],
        ['delete', sql`delete from package where id = ${id}`],
      ] as const) {
        expect(await failure(tx, (sp) => sp.execute(statement)), name).toBe('42501');
      }
    });
  });

  // SCH-10: a reschedule the patient asks for uses one of the package's reschedules, and is
  // refused when none is left or for a Zero Gravity Treadmill package session; the clinic's never.
  describe('the package reschedule allowance', () => {
    const settings = {
      sessionTypes: ['session', 'zero_gravity_treadmill'],
      neverReschedulable: ['zero_gravity_treadmill'],
    };
    let hours = 24;
    /** A booked appointment of a type in the episode, a day or more ahead. */
    const booked = async (
      tx: Tx,
      fixture: { patientId: string; episodeId: string; consultant: StaffMember },
      key: string,
    ) => {
      await asOwner(tx);
      hours += 2;
      // eslint-disable-next-line no-restricted-syntax -- hours ahead on purpose: a move is on any day
      const startsAt = new Date(Date.now() + hours * 60 * 60_000);
      const [row] = await tx
        .insert(appointment)
        .values({
          number: '',
          patientId: fixture.patientId,
          centreId: centreIds.hsrLayout,
          physioId: fixture.consultant.id,
          appointmentTypeId: await typeId(tx, key),
          episodeId: fixture.episodeId,
          machine: key === 'zero_gravity_treadmill' ? 'zero_gravity_treadmill' : null,
          machineUnit: key === 'zero_gravity_treadmill' ? 1 : null,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          channel: 'front_desk',
          bookedBy: deskHsr.id,
        })
        .returning({ id: appointment.id });
      return row?.id ?? '';
    };
    /** The desk moves it, asked by the patient or the clinic; the Postgres code when refused. */
    const move = (tx: Tx, appointmentId: string, reason: 'patient' | 'clinic') =>
      failure(tx, async (sp) => {
        await asOwner(sp);
        await becomeStaff(sp, deskHsr);
        const changed = await changeAppointment(sp, {
          appointmentId,
          status: 'rescheduled',
          reason,
          changedBy: deskHsr.id,
          now: new Date(),
        });
        expect(changed?.id).toBe(appointmentId);
      });
    const left = async (tx: Tx, paymentId: string) =>
      (await packageOf(tx, paymentId))?.reschedulesLeft;
    const statusOfVisit = async (tx: Tx, id: string) => {
      await asOwner(tx);
      const [row] = await tx
        .select({ status: appointment.status })
        .from(appointment)
        .where(eq(appointment.id, id));
      return row?.status;
    };

    it('uses one per patient-asked move of a session, then refuses; the clinic’s moves are free', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        const paid = await pay(tx, deskHsr, fixture.packageBillId);
        expect(await left(tx, paid)).toBe(1);
        const first = await booked(tx, fixture, 'session');
        await asOwner(tx);
        await becomeStaff(tx, deskHsr);
        expect(await packageRescheduleState(tx, first, settings)).toEqual({
          reschedulesLeft: 1,
          neverReschedulable: false,
        });
        expect(await move(tx, first, 'patient')).toBeUndefined();
        expect(await left(tx, paid)).toBe(0);

        const second = await booked(tx, fixture, 'session');
        expect(await move(tx, second, 'patient'), 'none left').toBe('23514');
        expect(await statusOfVisit(tx, second)).toBe('booked');
        expect(await move(tx, second, 'clinic'), 'the clinic').toBeUndefined();
        expect(await left(tx, paid)).toBe(0);

        // Consultations and reviews are not package sessions.
        for (const key of ['consultation', 'review']) {
          const other = await booked(tx, fixture, key);
          expect(await move(tx, other, 'patient'), key).toBeUndefined();
        }
        // Nor is a session once the package has expired.
        await asOwner(tx);
        await tx
          .update(patientPackage)
          .set({ validUntil: addDays(istDate(new Date()), -1) })
          .where(eq(patientPackage.paymentId, paid));
        const late = await booked(tx, fixture, 'session');
        expect(await move(tx, late, 'patient'), 'expired').toBeUndefined();
      });
    });

    it('never lets the patient move a Zero Gravity Treadmill package session; the clinic may', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 20);
        const paid = await pay(tx, deskHsr, fixture.packageBillId);
        const treadmill = await booked(tx, fixture, 'zero_gravity_treadmill');
        await asOwner(tx);
        await becomeStaff(tx, deskHsr);
        expect(await packageRescheduleState(tx, treadmill, settings)).toEqual({
          reschedulesLeft: 2,
          neverReschedulable: true,
        });
        expect(await move(tx, treadmill, 'patient')).toBe('23514');
        expect(await move(tx, treadmill, 'clinic')).toBeUndefined();
        expect(await left(tx, paid)).toBe(2);
      });
    });

    it('lets a session without a package, or with its payment undone, move as before', async () => {
      await rolledBack(async (tx) => {
        const fixture = await billed(tx);
        const session = await booked(tx, fixture, 'session');
        await asOwner(tx);
        await becomeStaff(tx, deskHsr);
        expect(await packageRescheduleState(tx, session, settings)).toBeUndefined();
        expect(await move(tx, session, 'patient')).toBeUndefined();
      });
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 10);
        const paid = await pay(tx, deskHsr, fixture.packageBillId);
        await becomeStaff(tx, deskHsr);
        await undoPayment(tx, { paymentId: paid, reason: 'Wrong package' });
        const session = await booked(tx, fixture, 'zero_gravity_treadmill');
        expect(await move(tx, session, 'patient')).toBeUndefined();
      });
    });
  });

  // SES-01: a checked in session is session n of the episode, in check in order, of the plan's
  // planned sessions; the episode's status gives the gate.
  describe('session check in', () => {
    let minutes = 8 * 60;
    let arrivals = 0;
    /** A booked appointment of a type in the episode, today in IST from 08:00 on. */
    const visitOf = async (
      tx: Tx,
      fixture: { patientId: string; episodeId: string; consultant: StaffMember },
      key: string,
    ) => {
      await asOwner(tx);
      // Clear of the fixture's consultation, which is booked around now.
      do {
        minutes += 45;
      } while (
        Math.abs(istInstant(istDate(new Date()), minutes).getTime() - Date.now()) <
        45 * 60_000
      );
      const startsAt = istInstant(istDate(new Date()), minutes);
      const [row] = await tx
        .insert(appointment)
        .values({
          number: '',
          patientId: fixture.patientId,
          centreId: centreIds.hsrLayout,
          physioId: fixture.consultant.id,
          appointmentTypeId: await typeId(tx, key),
          episodeId: fixture.episodeId,
          machine: key === 'zero_gravity_treadmill' ? 'zero_gravity_treadmill' : null,
          machineUnit: key === 'zero_gravity_treadmill' ? 1 : null,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          channel: 'front_desk',
          bookedBy: deskHsr.id,
        })
        .returning({ id: appointment.id });
      return row?.id ?? '';
    };
    const arrive = async (tx: Tx, appointmentId: string) => {
      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      arrivals += 1;
      await checkIn(tx, {
        appointmentId,
        by: deskHsr.id,
        now: new Date(Date.now() + arrivals * 1000),
      });
    };
    const read = async (tx: Tx, actor: StaffMember, ids: string[]) => {
      await asOwner(tx);
      await becomeStaff(tx, actor);
      return sessionProgress(tx, ids);
    };

    it('numbers checked in sessions in order against the plan, and gives a number back on undo', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        await pay(tx, deskHsr, fixture.packageBillId);
        const first = await visitOf(tx, fixture, 'session');
        const second = await visitOf(tx, fixture, 'session');
        const treadmill = await visitOf(tx, fixture, 'zero_gravity_treadmill');
        const later = await visitOf(tx, fixture, 'session');
        const review = await visitOf(tx, fixture, 'review');
        for (const id of [first, second, treadmill, review]) await arrive(tx, id);
        const ids = [first, second, treadmill, later, review, fixture.appointmentId];
        const progress = await read(tx, deskHsr, ids);
        expect(progress.get(first)).toEqual({ number: 1, planned: 12, episodeStatus: 'active' });
        expect(progress.get(second)?.number).toBe(2);
        expect(progress.get(treadmill)?.number).toBe(3);
        expect(progress.get(later)).toEqual({ number: null, planned: 12, episodeStatus: 'active' });
        expect(progress.has(review), 'a review is not a session').toBe(false);
        expect(progress.has(fixture.appointmentId), 'nor a consultation').toBe(false);

        // The second check in undone: its number goes to the treadmill visit.
        await asOwner(tx);
        await becomeStaff(tx, deskHsr);
        await undoCheckIn(tx, { appointmentId: second, now: new Date() });
        const after = await read(tx, deskHsr, ids);
        expect(after.get(second)?.number).toBeNull();
        expect(after.get(treadmill)?.number).toBe(2);

        // The treating physio reads it too; the desk at another centre does not.
        expect((await read(tx, fixture.consultant, [first])).get(first)?.number).toBe(1);
        expect((await read(tx, deskKoramangala, ids)).size).toBe(0);
      });
    });

    it('carries the episode status the gate is worked out from', async () => {
      await rolledBack(async (tx) => {
        const fixture = await billed(tx);
        const session = await visitOf(tx, fixture, 'session');
        await arrive(tx, session);
        expect((await read(tx, deskHsr, [session])).get(session)).toEqual({
          number: 1,
          planned: 12,
          episodeStatus: 'plan_proposed',
        });
      });
    });

    // SES-02: the session screen's appointment, under row level security (the second check).
    it('gives the session screen its visit for the physio, colleagues at the centre and the Super Admin', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        const session = await visitOf(tx, fixture, 'session');
        const as = async (actor: StaffMember) => {
          await asOwner(tx);
          await becomeStaff(tx, actor);
          return sessionVisit(tx, session);
        };
        expect(await as(fixture.consultant)).toMatchObject({
          id: session,
          physioId: fixture.consultant.id,
          episodeId: fixture.episodeId,
          typeKey: 'session',
          patientId: fixture.patientId,
        });
        expect((await as(superAdmin))?.id).toBe(session);
        // SES-08: colleagues at the centre read it, for cover; a physio elsewhere does not.
        expect((await as(physioHsr))?.id, 'a colleague at the centre').toBe(session);
        expect(await as(fixture.elsewhere), 'a physio elsewhere').toBeUndefined();
        expect(await as(deskKoramangala)).toBeUndefined();
      });
    });

    // SES-03: the session note, opened by Start session and signed by Close session.
    const started = async (
      tx: Tx,
      fixture: { patientId: string; episodeId: string; consultant: StaffMember },
    ) => {
      const id = await visitOf(tx, fixture, 'session');
      await arrive(tx, id);
      await asOwner(tx);
      await becomeStaff(tx, fixture.consultant);
      await startVisit(tx, { appointmentId: id, by: fixture.consultant.id, now: new Date() });
      const version = await latestKnowledgeVersion(tx);
      const sessionId = await openSession(tx, {
        appointmentId: id,
        physioId: fixture.consultant.id,
        kbVersionId: version?.id ?? '',
        note: { sinceLastVisit: 'Stairs easier' },
      });
      return { appointmentId: id, sessionId };
    };
    const noteAs = async (tx: Tx, actor: StaffMember, appointmentId: string) => {
      await asOwner(tx);
      await becomeStaff(tx, actor);
      return sessionNoteOf(tx, appointmentId);
    };
    const closing = (by: string, sessionId: string, baseVersion: number) => ({
      sessionId,
      baseVersion,
      by,
      pain: { rest: 2, activity: 4, after: 1 },
    });

    it('opens one session per visit, numbered from the appointment, written by its physio only', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        const { appointmentId, sessionId } = await started(tx, fixture);
        expect(
          await openSession(tx, {
            appointmentId,
            physioId: fixture.consultant.id,
            kbVersionId: (await latestKnowledgeVersion(tx))?.id ?? '',
            note: {},
          }),
          'once per visit',
        ).toBe(sessionId);
        await asOwner(tx);
        const [row] = await tx
          .select()
          .from(treatmentSession)
          .where(eq(treatmentSession.id, sessionId));
        expect(row).toMatchObject({
          number: 1,
          episodeId: fixture.episodeId,
          patientId: fixture.patientId,
          physioId: fixture.consultant.id,
          planOfCareId: fixture.planOfCareId,
          status: 'draft',
          version: 1,
        });

        // Its physio saves at the version; a stale save answers with what is saved.
        await becomeStaff(tx, fixture.consultant);
        expect(await saveSessionNote(tx, sessionId, 1, { sinceLastVisit: 'Better' })).toEqual({
          status: 'saved',
          version: 2,
        });
        expect((await saveSessionNote(tx, sessionId, 1, {})).status).toBe('conflict');
        expect(
          await failure(tx, (sp) =>
            sp
              .update(treatmentSession)
              .set({ number: 5 })
              .where(eq(treatmentSession.id, sessionId)),
          ),
          'only the note changes',
        ).toBe('23514');

        // A colleague at the centre reads it but cannot write it; the desk and another centre
        // read nothing.
        expect((await noteAs(tx, fixture.colleague, appointmentId))?.version).toBe(2);
        expect((await saveSessionNote(tx, sessionId, 2, {})).status).toBe('conflict');
        expect(await noteAs(tx, deskHsr, appointmentId)).toBeUndefined();
        expect(await noteAs(tx, fixture.elsewhere, appointmentId)).toBeUndefined();
        await asOwner(tx);
        await becomeStaff(tx, support);
        const touched = await tx
          .update(treatmentSession)
          .set({ note: {} })
          .where(eq(treatmentSession.id, sessionId))
          .returning({ id: treatmentSession.id });
        expect(touched, 'support is read only').toHaveLength(0);
      });
    });

    it('closes by signing: the visit completes and the package uses one session; it never changes again', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        await pay(tx, deskHsr, fixture.packageBillId);
        const { appointmentId, sessionId } = await started(tx, fixture);
        await asOwner(tx);
        await becomeStaff(tx, fixture.colleague);
        expect(
          await signSession(tx, closing(fixture.colleague.id, sessionId, 1)),
          'not their session',
        ).toBe('stale');
        expect(
          await noteAs(tx, adminWithoutTick, appointmentId),
          'a draft stays with the centre',
        ).toBeUndefined();
        await asOwner(tx);
        await becomeStaff(tx, fixture.consultant);
        expect(await signSession(tx, closing(fixture.consultant.id, sessionId, 9)), 'stale').toBe(
          'stale',
        );
        expect(await signSession(tx, closing(fixture.consultant.id, sessionId, 1))).toBe('signed');
        // The next note's prefill and "Same as last time" (SES-04) read it, with its number.
        const last = await lastSignedSessionNote(tx, fixture.episodeId);
        expect(last).toMatchObject({ number: 1, note: { sinceLastVisit: 'Stairs easier' } });
        expect(last?.signedAt).toBeInstanceOf(Date);

        await asOwner(tx);
        const [visit] = await tx
          .select({ status: appointment.status, completedAt: appointment.completedAt })
          .from(appointment)
          .where(eq(appointment.id, appointmentId));
        expect(visit?.status).toBe('completed');
        expect(visit?.completedAt).not.toBeNull();
        const [held] = await tx
          .select({ id: patientPackage.id, used: patientPackage.sessionsUsed })
          .from(patientPackage)
          .where(eq(patientPackage.episodeId, fixture.episodeId));
        expect(held?.used).toBe(1);
        const [row] = await tx
          .select()
          .from(treatmentSession)
          .where(eq(treatmentSession.id, sessionId));
        expect(row).toMatchObject({
          status: 'signed',
          signedBy: fixture.consultant.id,
          packageId: held?.id,
          painRest: 2,
          painActivity: 4,
          painAfter: 1,
        });
        const tasks = await tx
          .select({ id: task.id })
          .from(task)
          .where(and(eq(task.episodeId, fixture.episodeId), eq(task.kind, 'review.new_symptoms')));
        expect(tasks, 'no new symptoms, no task').toHaveLength(0);

        // Signed, it is part of the record: clinicians read it at any centre (CLN-12), the Super
        // Admin without the tick too; never Velyx support.
        expect((await noteAs(tx, adminWithoutTick, appointmentId))?.status).toBe('signed');
        expect((await noteAs(tx, fixture.elsewhere, appointmentId))?.status).toBe('signed');
        expect(await noteAs(tx, support, appointmentId)).toBeUndefined();
        expect(await noteAs(tx, deskHsr, appointmentId)).toBeUndefined();

        await asOwner(tx);
        expect(
          await failure(tx, (sp) =>
            sp
              .update(treatmentSession)
              .set({ note: { sinceLastVisit: 'Changed later' } })
              .where(eq(treatmentSession.id, sessionId)),
          ),
          'not even by the owner of the database',
        ).toBe('23514');
        expect(
          await failure(tx, (sp) =>
            sp
              .update(treatmentSession)
              .set({ signedAt: new Date(Date.now() - 60_000) })
              .where(eq(treatmentSession.id, sessionId)),
          ),
          'nor who signed it or when',
        ).toBe('23514');
      });
    });

    it('still closes without a package, and new symptoms give the consultant a task', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        const { sessionId } = await started(tx, fixture);
        await becomeStaff(tx, fixture.consultant);
        expect(
          await saveSessionNote(tx, sessionId, 1, {
            newSymptoms: { answer: 'yes', description: 'Tingling in the foot since Sunday' },
          }),
        ).toEqual({ status: 'saved', version: 2 });
        expect(await signSession(tx, closing(fixture.consultant.id, sessionId, 2))).toBe('signed');
        await asOwner(tx);
        const [row] = await tx
          .select({ packageId: treatmentSession.packageId })
          .from(treatmentSession)
          .where(eq(treatmentSession.id, sessionId));
        expect(row?.packageId, 'no active package').toBeNull();
        const tasks = await tx
          .select({
            title: task.title,
            priority: task.priority,
            assignee: task.assigneeStaffUserId,
          })
          .from(task)
          .where(and(eq(task.episodeId, fixture.episodeId), eq(task.kind, 'review.new_symptoms')));
        expect(tasks).toEqual([
          {
            title: 'New symptoms reported in session 1',
            priority: 'high',
            assignee: fixture.consultant.id,
          },
        ]);
      });
    });

    // SES-08 (user decisions 26 October 2026): a colleague who covers a session writes and signs
    // its note; the booked physio reads it but cannot write it.
    it('gives a covered session’s note to the colleague who started it', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        const id = await visitOf(tx, fixture, 'session');
        await arrive(tx, id);
        await asOwner(tx);
        await becomeStaff(tx, fixture.elsewhere);
        expect(
          await startVisit(tx, { appointmentId: id, by: fixture.elsewhere.id, now: new Date() }),
          'not from another centre',
        ).toBeUndefined();
        await asOwner(tx);
        await becomeStaff(tx, fixture.colleague);
        expect(
          await startVisit(tx, { appointmentId: id, by: fixture.colleague.id, now: new Date() }),
        ).toEqual({ id });
        const sessionId = await openSession(tx, {
          appointmentId: id,
          physioId: fixture.colleague.id,
          kbVersionId: (await latestKnowledgeVersion(tx))?.id ?? '',
          note: { sinceLastVisit: 'Covered today' },
        });
        expect((await sessionNoteOf(tx, id))?.physioId, 'the writer').toBe(fixture.colleague.id);

        // The booked physio reads it but cannot write it.
        await asOwner(tx);
        await becomeStaff(tx, fixture.consultant);
        expect((await sessionNoteOf(tx, id))?.version).toBe(1);
        expect((await saveSessionNote(tx, sessionId, 1, {})).status).toBe('conflict');
        expect(
          await signSession(tx, closing(fixture.consultant.id, sessionId, 1)),
          'nor sign it',
        ).toBe('stale');

        await asOwner(tx);
        await becomeStaff(tx, fixture.colleague);
        expect(await signSession(tx, closing(fixture.colleague.id, sessionId, 1))).toBe('signed');
        await asOwner(tx);
        const [row] = await tx
          .select({ physioId: treatmentSession.physioId, signedBy: treatmentSession.signedBy })
          .from(treatmentSession)
          .where(eq(treatmentSession.id, sessionId));
        expect(row).toEqual({ physioId: fixture.colleague.id, signedBy: fixture.colleague.id });
        const [visit] = await tx
          .select({ status: appointment.status, physioId: appointment.physioId })
          .from(appointment)
          .where(eq(appointment.id, id));
        expect(visit).toEqual({ status: 'completed', physioId: fixture.consultant.id });
      });
    });

    // SES-06 (user decisions 26 October 2026): an adverse event, ticked under the response with a
    // description, is taken from the note on closing and alerts the consultant and the Clinical
    // Director (the Super Admin role, DECISION SES-06).
    it('takes an adverse event from the signed note and alerts the consultant and the Clinical Director', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        const { sessionId } = await started(tx, fixture);
        await becomeStaff(tx, fixture.consultant);
        expect(
          await failure(tx, (sp) =>
            sp
              .update(treatmentSession)
              .set({ adverseEvent: 'Set by hand' })
              .where(eq(treatmentSession.id, sessionId)),
          ),
          'nobody sets it themselves',
        ).toBe('23514');
        const adverse = (description: string) => ({
          response: { rating: 'worse', note: '', adverseEvent: { reported: true, description } },
        });
        expect(await saveSessionNote(tx, sessionId, 1, adverse('   '))).toEqual({
          status: 'saved',
          version: 2,
        });
        expect(
          await failure(tx, (sp) => signSession(sp, closing(fixture.consultant.id, sessionId, 2))),
          'ticked needs a description',
        ).toBe('23514');
        expect(
          await saveSessionNote(tx, sessionId, 2, adverse(' Dizzy after shockwave, settled ')),
        ).toEqual({ status: 'saved', version: 3 });
        expect(await signSession(tx, closing(fixture.consultant.id, sessionId, 3))).toBe('signed');

        await asOwner(tx);
        const [row] = await tx
          .select({ adverseEvent: treatmentSession.adverseEvent })
          .from(treatmentSession)
          .where(eq(treatmentSession.id, sessionId));
        expect(row?.adverseEvent).toBe('Dizzy after shockwave, settled');
        const tasks = await tx
          .select({
            kind: task.kind,
            title: task.title,
            priority: task.priority,
            assignee: task.assigneeStaffUserId,
            role: task.assigneeRole,
          })
          .from(task)
          .where(
            and(eq(task.episodeId, fixture.episodeId), sql`${task.kind} like 'review.adverse%'`),
          )
          .orderBy(task.kind);
        expect(tasks).toEqual([
          {
            kind: 'review.adverse_event',
            title: 'Adverse event in session 1',
            priority: 'high',
            assignee: fixture.consultant.id,
            role: null,
          },
          {
            kind: 'review.adverse_event_director',
            title: 'Adverse event in session 1: Clinical Director review',
            priority: 'high',
            assignee: null,
            role: 'super_admin',
          },
        ]);
      });
    });

    it('raises no adverse event task and stores none when none is ticked', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        const { sessionId } = await started(tx, fixture);
        await becomeStaff(tx, fixture.consultant);
        // Described but not ticked: not an adverse event.
        expect(
          await saveSessionNote(tx, sessionId, 1, {
            response: { adverseEvent: { reported: false, description: 'Leftover text' } },
          }),
        ).toEqual({ status: 'saved', version: 2 });
        expect(await signSession(tx, closing(fixture.consultant.id, sessionId, 2))).toBe('signed');
        await asOwner(tx);
        const [row] = await tx
          .select({ adverseEvent: treatmentSession.adverseEvent })
          .from(treatmentSession)
          .where(eq(treatmentSession.id, sessionId));
        expect(row?.adverseEvent).toBeNull();
        const tasks = await tx
          .select({ id: task.id })
          .from(task)
          .where(
            and(eq(task.episodeId, fixture.episodeId), sql`${task.kind} like 'review.adverse%'`),
          );
        expect(tasks).toHaveLength(0);
      });
    });

    // CLN-12 follow up (user decisions 26 October 2026): a signed session note changes only by
    // addenda, added as on a consultation: the Treats patients tick, at the episode's centre or on
    // one's own note.
    it('takes addenda once signed, at its centre or from its physio, read wherever the note is', async () => {
      await rolledBack(async (tx) => {
        const fixture = await chosenPackage(tx, 12);
        const { appointmentId, sessionId } = await started(tx, fixture);
        const addAs = async (actor: StaffMember, text: string, episodeId = fixture.episodeId) => {
          await asOwner(tx);
          await becomeStaff(tx, actor);
          return failure(tx, (sp) =>
            addSessionAddendum(sp, { sessionId, episodeId, text, authorId: actor.id }),
          );
        };
        const readAs = async (actor: StaffMember) => {
          await asOwner(tx);
          await becomeStaff(tx, actor);
          // Both are written in one transaction here, at the same time.
          return (await sessionAddenda(tx, sessionId)).map((entry) => entry.text).sort();
        };
        expect(await addAs(fixture.consultant, 'Too early'), 'a draft has none').toBe('42501');

        await asOwner(tx);
        await becomeStaff(tx, fixture.consultant);
        expect(await signSession(tx, closing(fixture.consultant.id, sessionId, 1))).toBe('signed');
        await asOwner(tx);
        const [jobsBefore] = await tx.select({ count: sql<number>`count(*)::int` }).from(job);

        expect(await addAs(fixture.consultant, 'Pain at rest was 3, not 2.')).toBeUndefined();
        expect(await addAs(fixture.colleague, 'Reviewed with the patient.')).toBeUndefined();
        expect(await addAs(fixture.elsewhere, 'From another centre'), 'not their centre').toBe(
          '42501',
        );
        expect(await addAs(adminWithoutTick, 'No tick'), 'no Treats patients tick').toBe('42501');
        expect(await addAs(deskHsr, 'The desk')).toBe('42501');
        expect(await addAs(support, 'Support')).toBe('42501');
        await asOwner(tx);
        const otherEpisode = await insertEpisode(tx, {
          patientId: fixture.patientId,
          centreId: centreIds.hsrLayout,
        });
        expect(
          await addAs(fixture.consultant, 'Another episode', otherEpisode),
          'only on its own episode',
        ).toBe('42501');

        const both = ['Pain at rest was 3, not 2.', 'Reviewed with the patient.'].sort();
        expect(await readAs(fixture.consultant)).toEqual(both);
        expect(await readAs(fixture.elsewhere), 'read at any centre').toEqual(both);
        expect(await readAs(adminWithoutTick)).toEqual(both);
        expect(await readAs(deskHsr)).toEqual([]);
        expect(await readAs(support)).toEqual([]);

        // On the record, with names, at another centre.
        await asOwner(tx);
        await becomeStaff(tx, fixture.elsewhere);
        const [onRecord] = await signedSessionNotesOf(tx, fixture.patientId);
        expect(onRecord).toMatchObject({
          kind: 'session',
          id: sessionId,
          appointmentId,
          number: 1,
          signedBy: fixture.consultant.id,
          signedByName: fixture.consultant.name,
          note: { sinceLastVisit: 'Stairs easier' },
        });
        expect(onRecord?.centreName).not.toBeNull();
        expect(onRecord?.addenda.map((entry) => entry.authorName).sort()).toEqual(
          [fixture.consultant.name, fixture.colleague.name].sort(),
        );
        await asOwner(tx);
        await becomeStaff(tx, deskHsr);
        expect(await signedSessionNotesOf(tx, fixture.patientId)).toEqual([]);

        await asOwner(tx);
        const [jobsAfter] = await tx.select({ count: sql<number>`count(*)::int` }).from(job);
        expect(jobsAfter?.count, 'a session addendum queues no document').toBe(jobsBefore?.count);
        expect(
          await failure(tx, (sp) =>
            sp.insert(addendum).values({
              sessionId,
              consultationId: null,
              episodeId: fixture.episodeId,
              text: 'x',
              authorId: fixture.consultant.id,
            }),
          ),
          'the database owner may write one',
        ).toBeUndefined();
        expect(
          await failure(tx, (sp) =>
            sp.insert(addendum).values({
              episodeId: fixture.episodeId,
              text: 'On nothing',
              authorId: fixture.consultant.id,
            }),
          ),
          'an addendum belongs to exactly one note',
        ).toBe('23514');
        expect(
          await failure(tx, (sp) =>
            sp.insert(addendum).values({
              sessionId,
              consultationId: fixture.consultationId,
              episodeId: fixture.episodeId,
              text: 'On both',
              authorId: fixture.consultant.id,
            }),
          ),
        ).toBe('23514');
      });
    });
  });
});
