import {
  LOST_TO_FOLLOW_UP_CHECK_TIME,
  LOST_TO_FOLLOW_UP_TASK,
  lostToFollowUpTitle,
  nextDailyRun,
  watchedForLoss,
  type EpisodeStatus,
} from '@clinic-mx/schemas';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { updateEpisodeState } from './episodes';
import { enqueueJob } from './jobs/queue';
import { appointment, episode, task } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The lost to follow up check (OUT-10; PRD J5.12 and decision 19; TAD job table: daily; user
 * decisions 27 October 2026; docs/runbooks/sessions.md). Every morning an episode nobody has
 * attended for `clinical.lost_to_follow_up_days` (counted from the last attended visit, or the
 * opening when there was none), with nothing booked ahead, becomes Lost to follow up: never
 * discharged, never closed. The consultant who signed its consultation (or the centre's Centre
 * Manager before one) gets a task to call and decide. The task names the date, never the patient.
 */

export const LOST_TO_FOLLOW_UP_JOB = 'episodes.lost_to_follow_up';

/** Queues the check's next day (its own key per date, so queuing twice adds nothing). */
export async function queueNextLostToFollowUpCheck(
  db: DbOrTransaction,
  date: string,
  now: Date = new Date(),
): Promise<string> {
  const next = nextDailyRun(now, date, LOST_TO_FOLLOW_UP_CHECK_TIME);
  await enqueueJob(db, {
    kind: LOST_TO_FOLLOW_UP_JOB,
    payload: { date: next.date },
    runAt: next.runAt,
    idempotencyKey: [LOST_TO_FOLLOW_UP_JOB, next.date].join(':'),
  });
  return next.date;
}

/** An episode the check marks: since when nobody attended, and who is asked to call. */
export interface LostEpisode {
  id: string;
  status: EpisodeStatus;
  centreId: string;
  patientId: string;
  since: Date;
  /** The consultant who signed its consultation; none before one is signed. */
  consultantId: string | null;
}

/** Watched episodes not attended since before `now` less `days`, with nothing booked ahead. */
export async function lostEpisodes(
  db: DbOrTransaction,
  now: Date,
  days: number,
): Promise<LostEpisode[]> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // Qualified by hand: inside a subquery a bare "id" would be the subquery's own.
  const episodeId = sql.raw('"episode"."id"');
  const lastAttended = sql<Date>`greatest(${episode.openedAt}, (
    select max(a.starts_at) from public.appointment a
    where a.episode_id = ${episodeId} and a.status in ('checked_in', 'in_progress', 'completed')
  ))`;
  const rows = await db
    .select({
      id: episode.id,
      status: episode.status,
      centreId: episode.centreId,
      patientId: episode.patientId,
      since: lastAttended.mapWith((value: string | Date) => new Date(value)),
      consultantId: sql<string | null>`(
        select c.signed_by from public.consultation c
        where c.episode_id = ${episodeId} and c.status = 'signed'
        order by c.signed_at desc limit 1
      )`,
    })
    .from(episode)
    .where(
      and(
        inArray(episode.status, [...watchedForLoss]),
        sql`${lastAttended} < ${cutoff.toISOString()}`,
        sql`not exists (
          select 1 from public.appointment a
          where a.episode_id = ${episodeId} and a.status in ('booked', 'confirmed')
            and a.starts_at > ${now.toISOString()}
        )`,
      ),
    )
    .orderBy(asc(episode.openedAt));
  return rows;
}

/**
 * The day's check: each lost episode becomes Lost to follow up, with a high task for the
 * consultant, unless it moved meanwhile. Running a day twice changes nothing (a Lost episode is no
 * longer watched). The episodes marked.
 */
export async function markLostToFollowUp(
  db: DbOrTransaction,
  now: Date,
  days: number,
): Promise<string[]> {
  const marked: string[] = [];
  for (const lost of await lostEpisodes(db, now, days)) {
    const changed = await updateEpisodeState(db, lost.id, lost.status, {
      status: 'lost_to_follow_up',
      pausedFrom: lost.status,
    });
    if (!changed) continue;
    await db.insert(task).values({
      kind: LOST_TO_FOLLOW_UP_TASK,
      title: lostToFollowUpTitle(lost.since),
      details: { since: lost.since.toISOString(), days },
      priority: 'high',
      ...(lost.consultantId
        ? { assigneeStaffUserId: lost.consultantId }
        : { assigneeRole: 'centre_manager' as const }),
      centreId: lost.centreId,
      patientId: lost.patientId,
      episodeId: lost.id,
    });
    marked.push(lost.id);
  }
  return marked;
}

/** The episode's visits still booked ahead, soonest first: what discharging cancels. */
export function visitsAhead(
  db: DbOrTransaction,
  episodeId: string,
  now: Date = new Date(),
): Promise<{ id: string; number: string; startsAt: Date }[]> {
  return db
    .select({ id: appointment.id, number: appointment.number, startsAt: appointment.startsAt })
    .from(appointment)
    .where(
      and(
        eq(appointment.episodeId, episodeId),
        inArray(appointment.status, ['booked', 'confirmed']),
        gt(appointment.startsAt, now),
      ),
    )
    .orderBy(asc(appointment.startsAt));
}
