import {
  appointment,
  baselineMeasure,
  createDb,
  measure,
  systemActor,
  treatmentSession,
  withActor,
} from '@clinic-mx/db';
import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { startedAppointment } from './calendar';
import { consultationMeasures } from './consultations';

// The session 4 reassessment's end to end fixture (OUT-05): sessions 1 to 3 already signed, with
// the baseline session 1 froze. Removed with removeCalendarRows of the physio.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

export const PAIN = 'knee.marker.primary_task_pain_nrs_0_10'; // gitleaks:allow
export const EFFUSION = 'knee.marker.effusion_grade_0_3'; // gitleaks:allow
export const QUADRICEPS = 'knee.lsi.quadriceps'; // gitleaks:allow

/**
 * Sessions 1 to 3 of the episode with `physioId`, on the 9th, 6th and 3rd day before today, each
 * signed; session 1's baseline: quadriceps reused from the consultation (32 and 40 kg), task pain
 * recorded (6/10) and effusion not tested.
 */
export async function signedSessionsWithBaseline(values: {
  physioId: string;
  patientId: string;
  episodeId: string;
  consultationId: string;
}): Promise<string[]> {
  const { physioId, patientId, episodeId, consultationId } = values;
  await consultationMeasures(consultationId, 10, [
    { key: QUADRICEPS, limb: 'involved', value: 32, unit: 'kg' },
    { key: QUADRICEPS, limb: 'uninvolved', value: 40, unit: 'kg' },
  ]);
  const visits: string[] = [];
  for (const daysAgo of [9, 6, 3]) {
    const startsAt = istInstant(addDays(istDate(new Date()), -daysAgo), 600);
    const visit = await startedAppointment(physioId, patientId, 0, {
      values: {
        episodeId,
        startsAt,
        endsAt: istInstant(addDays(istDate(new Date()), -daysAgo), 645),
        status: 'checked_in',
        arrivedAt: startsAt,
        checkedInBy: physioId,
      },
    });
    visits.push(visit.id);
  }
  return withActor(db(), systemActor('tests'), async (tx) => {
    const [version] = await tx.execute<{ id: string }>(
      sql`select id from kb_version order by number desc limit 1`,
    );
    const kbVersionId = version?.id ?? '';
    const sessions: string[] = [];
    for (const appointmentId of visits) {
      const [visit] = await tx
        .select({ centreId: appointment.centreId })
        .from(appointment)
        .where(eq(appointment.id, appointmentId));
      // The database numbers the session and fills its episode from the visit.
      const [opened] = await tx
        .insert(treatmentSession)
        .values({
          appointmentId,
          episodeId,
          patientId,
          centreId: visit?.centreId ?? '',
          physioId,
          number: 1,
          kbVersionId,
        })
        .returning({ id: treatmentSession.id });
      const sessionId = opened?.id ?? '';
      await tx
        .update(treatmentSession)
        .set({
          status: 'signed',
          signedBy: physioId,
          signedAt: new Date(),
          painRest: 2,
          painActivity: 4,
          painAfter: 1,
        })
        .where(eq(treatmentSession.id, sessionId));
      sessions.push(sessionId);
    }
    const [first] = await tx
      .select({ id: treatmentSession.id })
      .from(treatmentSession)
      .where(eq(treatmentSession.episodeId, episodeId))
      .orderBy(treatmentSession.number)
      .limit(1);
    const sessionId = first?.id ?? '';
    await tx.insert(measure).values({
      episodeId,
      sessionId,
      kbVersionId,
      measureKey: PAIN,
      value: 6,
      unit: '/10',
      createdBy: physioId,
    });
    await tx.insert(baselineMeasure).values([
      { episodeId, sessionId, kbVersionId, measureKey: QUADRICEPS, consultationId },
      { episodeId, sessionId, kbVersionId, measureKey: PAIN },
      {
        episodeId,
        sessionId,
        kbVersionId,
        measureKey: EFFUSION,
        notTestedReason: 'Swelling not assessable',
      },
    ]);
    return sessions;
  });
}

/** The episode's reassessment task, as the database made it. */
export async function reassessmentTaskOf(episodeId: string) {
  const [row] = await db().execute<{ status: string; decision: string | null }>(
    sql`select status, decision from task where kind = 'review.reassessment'
      and episode_id = ${episodeId} order by created_at desc limit 1`,
  );
  return row;
}
