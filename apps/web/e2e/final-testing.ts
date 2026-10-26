import {
  appointment,
  appointmentType,
  createDb,
  measure,
  reassessment,
  systemActor,
  treatmentSession,
  withActor,
} from '@clinic-mx/db';
import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { startedAppointment } from './calendar';
import { PAIN, QUADRICEPS, EFFUSION, signedSessionsWithBaseline } from './reassessment';

// Final testing's end to end fixture (OUT-07): sessions 1 to 3 signed with session 1's baseline
// (`./reassessment`), then session 4 signed with its reassessment. Removed with removeCalendarRows
// of the physio and the consultant.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** An appointment type's id by its key, for example `review`. */
export async function appointmentTypeIdOf(key: string): Promise<string> {
  const [row] = await db()
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, key));
  if (!row) throw new Error('No such appointment type.');
  return row.id;
}

/**
 * The baseline of `signedSessionsWithBaseline`, then session 4 yesterday, signed, reassessing it:
 * quadriceps 36 and 39 kg, task pain 3/10, effusion not tested ("Still swollen").
 */
export async function reassessedEpisode(values: {
  physioId: string;
  patientId: string;
  episodeId: string;
  consultationId: string;
}): Promise<void> {
  const { physioId, patientId, episodeId } = values;
  await signedSessionsWithBaseline(values);
  const startsAt = istInstant(addDays(istDate(new Date()), -1), 600);
  const visit = await startedAppointment(physioId, patientId, 0, {
    values: {
      episodeId,
      startsAt,
      endsAt: istInstant(addDays(istDate(new Date()), -1), 645),
      status: 'checked_in',
      arrivedAt: startsAt,
      checkedInBy: physioId,
    },
  });
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [version] = await tx.execute<{ id: string }>(
      sql`select id from kb_version order by number desc limit 1`,
    );
    const kbVersionId = version?.id ?? '';
    const [row] = await tx
      .select({ centreId: appointment.centreId })
      .from(appointment)
      .where(eq(appointment.id, visit.id));
    const [opened] = await tx
      .insert(treatmentSession)
      .values({
        appointmentId: visit.id,
        episodeId,
        patientId,
        centreId: row?.centreId ?? '',
        physioId,
        number: 4,
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
        painActivity: 3,
        painAfter: 1,
      })
      .where(eq(treatmentSession.id, sessionId));
    await tx.insert(measure).values(
      [
        { key: QUADRICEPS, limb: 'involved' as const, value: 36, unit: 'kg' },
        { key: QUADRICEPS, limb: 'uninvolved' as const, value: 39, unit: 'kg' },
        { key: PAIN, limb: null, value: 3, unit: '/10' },
      ].map((reading) => ({
        episodeId,
        sessionId,
        kbVersionId,
        measureKey: reading.key,
        limb: reading.limb,
        value: reading.value,
        unit: reading.unit,
        createdBy: physioId,
      })),
    );
    // The database stamps the consultant and gives them the review task.
    await tx.insert(reassessment).values({
      episodeId,
      sessionId,
      kbVersionId,
      consultantId: sql`null`,
      notTested: { [EFFUSION]: 'Still swollen' },
    });
  });
}

/** The episode's final testing, as signed: who and the readings. */
export async function finalTestOf(episodeId: string) {
  const [row] = await db().execute<{ signed_by: string; readings: number }>(
    sql`select f.signed_by, (select count(*)::int from measure m where m.final_test_id = f.id)
      as readings from final_test f where f.episode_id = ${episodeId}`,
  );
  return row;
}
