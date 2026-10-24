import {
  appointment,
  appointmentType,
  centre,
  createDb,
  episode,
  kbVersion,
  patientLink,
  redFlagAlert,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { desc, eq } from 'drizzle-orm';

// Visits for My patients today (CLN-01), set up as the system the way check in and the submit
// pipeline leave them. Generated patients only (rule 12); removed with removeCalendarRows and
// removePipelineRows.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** Checked in by the given desk, as the front desk does it. */
export async function checkedIn(appointmentId: string, deskId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(appointment)
      .set({ status: 'checked_in', arrivedAt: new Date(), checkedInBy: deskId })
      .where(eq(appointment.id, appointmentId)),
  );
}

/**
 * The visit's health form submitted, which opened its episode, with one open red flag alert to
 * review, as the submit pipeline leaves it (INT-10).
 */
export async function submittedWithAlert(appointmentId: string, patientId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [hsr] = await tx.select({ id: centre.id }).from(centre).where(eq(centre.code, 'HSR'));
    const [version] = await tx
      .select({ id: kbVersion.id })
      .from(kbVersion)
      .orderBy(desc(kbVersion.number))
      .limit(1);
    if (!hsr || !version) throw new Error('No centre or knowledge base version; run kb:import.');
    const [opened] = await tx
      .insert(episode)
      .values({ patientId, centreId: hsr.id })
      .returning({ id: episode.id });
    if (!opened) throw new Error('The episode was not recorded.');
    await tx
      .update(appointment)
      .set({ episodeId: opened.id })
      .where(eq(appointment.id, appointmentId));
    await tx.insert(patientLink).values({
      patientId,
      purpose: 'health_form',
      appointmentId,
      expiresAt: new Date(Date.now() + 3600_000),
      completedAt: new Date(),
    });
    await tx.insert(redFlagAlert).values({
      episodeId: opened.id,
      appointmentId,
      kbVersionId: version.id,
      ruleKey: 'e2e.my_patients',
      name: 'Test alert',
      triage: 'urgent_medical_referral',
      display: 'review',
      action: 'Refer.',
      signedOff: false,
    });
  });
}

/** The Consultation type, so a visit's button reads "Start consultation". */
export async function consultationTypeId(): Promise<string> {
  const [row] = await db()
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, 'consultation'));
  if (!row) throw new Error('No Consultation type.');
  return row.id;
}
