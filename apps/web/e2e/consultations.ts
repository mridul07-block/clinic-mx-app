import {
  appointment,
  consultation,
  createDb,
  diagnosis,
  intakeResponse,
  kbCondition,
  measure,
  patientLink,
  planOfCare,
  precaution,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { currentHealthFormVersion, type HealthFormAnswers } from '@clinic-mx/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';

// Reading consultations back for the CLN-02 end to end tests; removed with removeCalendarRows.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

type SavedSection = { notes?: string; confirmed?: Record<string, unknown> };

/** The visit's consultation as saved: its sections and version, or undefined. */
export async function savedConsultation(
  appointmentId: string,
): Promise<{ sections: Record<string, SavedSection>; version: number } | undefined> {
  const [row] = await db()
    .select({ sections: consultation.sections, version: consultation.version })
    .from(consultation)
    .where(eq(consultation.appointmentId, appointmentId));
  return row && { sections: row.sections as Record<string, SavedSection>, version: row.version };
}

/**
 * The visit's health form as submitted with these generated answers (CLN-03), through the health
 * form link `submittedWithAlert` made; removed with the appointment.
 */
export async function submittedAnswers(
  appointmentId: string,
  patientId: string,
  answers: HealthFormAnswers,
): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [link] = await tx
      .select({ id: patientLink.id })
      .from(patientLink)
      .where(
        and(eq(patientLink.appointmentId, appointmentId), eq(patientLink.purpose, 'health_form')),
      );
    if (!link) throw new Error('No health form link; call submittedWithAlert first.');
    await tx.insert(intakeResponse).values({
      appointmentId,
      patientId,
      patientLinkId: link.id,
      formVersion: currentHealthFormVersion,
      answers,
      submittedAt: new Date(),
    });
  });
}

/**
 * The visit's draft consultation with these sections, saved as the next version (CLN-09: a
 * consultation ready to sign without filling every screening item on screen).
 */
export async function draftSections(
  appointmentId: string,
  sections: Record<string, unknown>,
): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(consultation)
      .set({ sections, version: sql`${consultation.version} + 1`, updatedAt: new Date() })
      .where(eq(consultation.appointmentId, appointmentId)),
  );
}

/** What signing the visit's consultation wrote (CLN-09): counts by table, and the visit status. */
export async function signedRows(appointmentId: string) {
  const [row] = await db().execute<{
    status: string;
    visit: string;
    measures: number;
    tests: number;
    diagnoses: number;
    plans: number;
    modalities: number;
  }>(sql`select c.status::text as status, a.status::text as visit,
      (select count(*)::int from measure m where m.consultation_id = c.id) as measures,
      (select count(*)::int from special_test_result t where t.consultation_id = c.id) as tests,
      (select count(*)::int from diagnosis d where d.consultation_id = c.id) as diagnoses,
      (select count(*)::int from plan_of_care p where p.consultation_id = c.id) as plans,
      (select count(*)::int from plan_modality pm join plan_of_care p on p.id = pm.plan_of_care_id
        where p.consultation_id = c.id) as modalities
    from consultation c join appointment a on a.id = c.appointment_id
    where c.appointment_id = ${appointmentId}`);
  return row;
}

/**
 * A signed consultation for the visit, as signing writes it (CLN-12 reads it on the patient
 * record): signed by its physio now, with a working diagnosis on a knee condition of the newest
 * knowledge base version, a plan of care, and a precaution on the visit's episode. Generated
 * wording only; removed with removeCalendarRows and removePipelineRows.
 */
export async function signedConsultation(
  appointmentId: string,
  physioId: string,
  options: { sections?: Record<string, unknown> } = {},
): Promise<{ consultationId: string; conditionName: string }> {
  return withActor(db(), systemActor('tests'), async (tx) => {
    const [visit] = await tx
      .select({ episodeId: appointment.episodeId })
      .from(appointment)
      .where(eq(appointment.id, appointmentId));
    const episodeId = visit?.episodeId;
    if (!episodeId) throw new Error('The visit has no episode; call submittedWithAlert first.');
    const [condition] = await tx
      .select({
        kbVersionId: kbCondition.kbVersionId,
        conditionId: kbCondition.conditionId,
        name: kbCondition.name,
      })
      .from(kbCondition)
      .where(
        and(
          eq(kbCondition.homeRegion, 'knee'),
          eq(
            kbCondition.kbVersionId,
            sql`(select id from kb_version order by number desc limit 1)`,
          ),
        ),
      )
      .orderBy(asc(kbCondition.conditionId))
      .limit(1);
    if (!condition) throw new Error('No knee condition; run kb:import.');
    const now = new Date();
    const [row] = await tx
      .insert(consultation)
      .values({
        appointmentId,
        episodeId,
        physioId,
        kbVersionId: condition.kbVersionId,
        sections: options.sections ?? {},
        status: 'signed',
        signedBy: physioId,
        signedAt: now,
      })
      .returning({ id: consultation.id });
    if (!row) throw new Error('The consultation was not recorded.');
    await tx.insert(diagnosis).values({
      consultationId: row.id,
      episodeId,
      kbVersionId: condition.kbVersionId,
      conditionId: condition.conditionId,
      movementDx: 'Dynamic valgus on step down',
      irritability: 'moderate',
      stage: 'subacute',
      provisional: false,
    });
    await tx.insert(planOfCare).values({
      episodeId,
      consultationId: row.id,
      version: 1,
      goals: [{ text: 'Climb stairs without pain', patient: true }],
      interventions: ['exercise'],
      sessionsPerWeek: 2,
      weeks: 6,
      homeProgramme: [{ exercise: 'Step downs', dose: '3 x 10', note: '' }],
      reviewDate: '2026-12-05',
      treatingPhysioId: physioId,
      createdBy: physioId,
    });
    await tx.insert(precaution).values({
      episodeId,
      key: 'pregnancy',
      label: 'Pregnancy',
      source: 'health_form',
      formVersion: currentHealthFormVersion,
    });
    return { consultationId: row.id, conditionName: condition.name };
  });
}

/**
 * Measures a signed consultation took (OUT-01's baseline), as signing writes them, taken the given
 * days before now.
 */
export async function consultationMeasures(
  consultationId: string,
  daysAgo: number,
  rows: { key: string; limb?: 'involved' | 'uninvolved'; value: number; unit: string }[],
): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [taken] = await tx
      .select({
        episodeId: consultation.episodeId,
        kbVersionId: consultation.kbVersionId,
        physioId: consultation.physioId,
      })
      .from(consultation)
      .where(eq(consultation.id, consultationId));
    if (!taken) throw new Error('The consultation was not recorded.');
    await tx.insert(measure).values(
      rows.map((row) => ({
        episodeId: taken.episodeId,
        consultationId,
        kbVersionId: taken.kbVersionId,
        measureKey: row.key,
        limb: row.limb ?? null,
        value: row.value,
        unit: row.unit,
        takenAt: new Date(Date.now() - daysAgo * 24 * 60 * 60_000),
        createdBy: taken.physioId,
      })),
    );
  });
}

/** The baseline session 1's signing froze for an episode (OUT-01), by measure key. */
export async function frozenBaselineOf(
  episodeId: string,
): Promise<{ key: string; source: 'consultation' | 'session' | 'not_tested' }[]> {
  const rows = await db().execute<{
    key: string;
    source: 'consultation' | 'session' | 'not_tested';
  }>(
    sql`select measure_key as key,
        case when consultation_id is not null then 'consultation'
          when not_tested_reason is not null then 'not_tested' else 'session' end as source
      from baseline_measure where episode_id = ${episodeId} order by measure_key`,
  );
  return [...rows];
}

/** The record views of a patient's record by a staff member (CLN-12). */
export async function recordViews(patientId: string, staffId: string): Promise<number> {
  const [row] = await db().execute<{ views: number }>(
    sql`select count(*)::int as views from audit_event
      where entity = 'patient' and entity_id = ${patientId} and action = 'view'
        and actor = ${`staff:${staffId}`}`,
  );
  return row?.views ?? 0;
}
