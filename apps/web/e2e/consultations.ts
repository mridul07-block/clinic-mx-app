import {
  consultation,
  createDb,
  intakeResponse,
  patientLink,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { currentHealthFormVersion, type HealthFormAnswers } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';

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
