import {
  appointment,
  appointmentType,
  centre,
  createDb,
  episode,
  systemActor,
  updateEpisodeState,
  withActor,
} from '@clinic-mx/db';
import { istDate, startOfIstDay } from '@clinic-mx/schemas';
import { and, count, eq, gte, lt } from 'drizzle-orm';
import { startedAppointment } from './calendar';

// The figures for end to end tests (DSH-01): a consultation held today, and the count the page
// should show, read straight from the appointments.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

async function consultationType(): Promise<string> {
  const [row] = await db()
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, 'consultation'));
  if (!row) throw new Error('The Consultation appointment type is missing.');
  return row.id;
}

/** A consultation at HSR Layout an hour ago (kept on today's date), held and signed: completed. */
export async function heldConsultation(physioId: string, patientId: string): Promise<void> {
  await startedAppointment(physioId, patientId, 60, {
    values: { appointmentTypeId: await consultationType(), status: 'completed' },
  });
}

/** Consultations completed today at a centre, counted from the appointments. */
export async function consultationsHeldToday(centreCode: string): Promise<number> {
  const today = istDate(new Date());
  const [row] = await db()
    .select({ held: count() })
    .from(appointment)
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .where(
      and(
        eq(centre.code, centreCode),
        eq(appointment.appointmentTypeId, await consultationType()),
        eq(appointment.status, 'completed'),
        gte(appointment.startsAt, startOfIstDay(today)),
        lt(appointment.startsAt, new Date(startOfIstDay(today).getTime() + 24 * 3600_000)),
      ),
    );
  return row?.held ?? 0;
}

/** Puts an episode Awaiting consultation on hold (as a red flag referral does), as the system. */
export async function holdEpisode(episodeId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    updateEpisodeState(tx, episodeId, 'awaiting_consultation', {
      status: 'on_hold',
      pausedFrom: 'awaiting_consultation',
    }),
  );
}

/** Episodes on hold at a centre now, counted from the episodes. */
export async function episodesOnHold(centreCode: string): Promise<number> {
  const [row] = await db()
    .select({ held: count() })
    .from(episode)
    .innerJoin(centre, eq(centre.id, episode.centreId))
    .where(and(eq(centre.code, centreCode), eq(episode.status, 'on_hold')));
  return row?.held ?? 0;
}
