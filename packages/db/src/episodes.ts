import type {
  DischargeReason,
  EpisodeState,
  EpisodeStatus,
  ScreeningRegion,
} from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { centre, episode } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Clinical episodes (SCH-03). Run under row level security: every signed in staff member reads;
 * the Super Admin, Centre Managers and the Front Desk open them; any signed in staff member moves
 * them, through a service that checks its own permission. The `episode_transition_guard` trigger
 * refuses a status change the machine does not allow; the audit trigger keeps the history.
 */

export interface EpisodeEntry {
  id: string;
  patientId: string;
  centreId: string;
  /** Null when the reader does not see that centre. */
  centreName: string | null;
  bodyRegion: ScreeningRegion | null;
  status: EpisodeStatus;
  pausedFrom: EpisodeStatus | null;
  openedAt: Date;
  closedAt: Date | null;
  dischargeReason: DischargeReason | null;
  dischargeNote: string | null;
  linkedEpisodeId: string | null;
}

const columns = {
  id: episode.id,
  patientId: episode.patientId,
  centreId: episode.centreId,
  centreName: centre.name,
  bodyRegion: episode.bodyRegion,
  status: episode.status,
  pausedFrom: episode.pausedFrom,
  openedAt: episode.openedAt,
  closedAt: episode.closedAt,
  dischargeReason: episode.dischargeReason,
  dischargeNote: episode.dischargeNote,
  linkedEpisodeId: episode.linkedEpisodeId,
};

/** A patient's episodes, newest first. */
export function episodesOf(db: DbOrTransaction, patientId: string): Promise<EpisodeEntry[]> {
  return db
    .select(columns)
    .from(episode)
    .leftJoin(centre, eq(centre.id, episode.centreId))
    .where(eq(episode.patientId, patientId))
    .orderBy(desc(episode.openedAt));
}

/** One episode, or undefined when not found. */
export async function episodeRecord(
  db: DbOrTransaction,
  episodeId: string,
): Promise<EpisodeEntry | undefined> {
  const [row] = await db
    .select(columns)
    .from(episode)
    .leftJoin(centre, eq(centre.id, episode.centreId))
    .where(eq(episode.id, episodeId));
  return row;
}

/** Opens an episode as Intake pending; returns its id. */
export async function insertEpisode(
  db: DbOrTransaction,
  values: {
    patientId: string;
    centreId: string;
    bodyRegion?: ScreeningRegion;
    linkedEpisodeId?: string;
  },
): Promise<string> {
  const [row] = await db.insert(episode).values(values).returning({ id: episode.id });
  if (!row) throw new Error('The episode was not recorded.');
  return row.id;
}

/**
 * Moves an episode to `next`, only if it is still in `expected` (two changes at once cannot both
 * win); false when it was not (or not found). Discharge sets the reason, note and closing time.
 */
export async function updateEpisodeState(
  db: DbOrTransaction,
  episodeId: string,
  expected: EpisodeStatus,
  next: EpisodeState,
  discharge?: { reason: DischargeReason; note?: string },
): Promise<boolean> {
  const changed = await db
    .update(episode)
    .set({
      status: next.status,
      pausedFrom: next.pausedFrom,
      ...(next.status === 'discharged'
        ? {
            closedAt: sql`now()`,
            dischargeReason: discharge?.reason,
            dischargeNote: discharge?.note?.trim() || null,
          }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(episode.id, episodeId), eq(episode.status, expected)))
    .returning({ id: episode.id });
  return changed.length > 0;
}
