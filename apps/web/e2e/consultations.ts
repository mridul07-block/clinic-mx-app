import {
  consultation,
  createDb,
  intakeResponse,
  patientLink,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { currentHealthFormVersion, type HealthFormAnswers } from '@clinic-mx/schemas';
import { and, eq } from 'drizzle-orm';

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
