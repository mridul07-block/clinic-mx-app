import type { EpisodeStatus } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import type { DbOrTransaction } from './versioned';

/**
 * Treatment sessions at check in (SES-01; docs/runbooks/sessions.md): for each appointment of a
 * session type, its number in the episode once checked in, the plan's planned sessions and the
 * episode's status, from `internal.session_progress` (answers only for centres the reader sees).
 */

export interface SessionProgress {
  /** Null until the appointment is checked in, or outside an episode. */
  number: number | null;
  /** Sessions per week x weeks of the newest plan; null without a frequency. */
  planned: number | null;
  /** Null for an appointment outside an episode. */
  episodeStatus: EpisodeStatus | null;
}

/** Session progress by appointment id; appointments of other types are absent. */
export async function sessionProgress(
  db: DbOrTransaction,
  appointmentIds: readonly string[],
): Promise<Map<string, SessionProgress>> {
  if (appointmentIds.length === 0) return new Map();
  const rows = await db.execute<{
    appointment_id: string;
    session_number: number | null;
    planned: number | null;
    episode_status: EpisodeStatus | null;
  }>(sql`select * from internal.session_progress(${`{${appointmentIds.join(',')}}`}::uuid[])`);
  return new Map(
    rows.map((row) => [
      row.appointment_id,
      { number: row.session_number, planned: row.planned, episodeStatus: row.episode_status },
    ]),
  );
}
