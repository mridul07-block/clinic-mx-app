import {
  REVIEW_OVERDUE_CHECK_TIME,
  REVIEW_OVERDUE_TASK,
  nextDailyRun,
  reviewOverdueTitle,
} from '@clinic-mx/schemas';
import { sql, type SQL } from 'drizzle-orm';
import { enqueueJob } from './jobs/queue';
import { task } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The overdue 6 week review (ALT-02, in part; PRD section 7 and J6.1; Frontend Specification
 * "Reassessment overdue"; docs/runbooks/tasks.md). Every morning an Active episode whose newest
 * plan's review date has passed, with no Review attended, none booked ahead and no final test,
 * gets one task for the consultant who signed its consultation (the centre's Centre Manager
 * before one); an open one whose review is since booked or done is closed by itself. The task
 * names the date, never the patient.
 */

export const REVIEW_OVERDUE_JOB = 'episodes.review_overdue';

/** Queues the check's next day (its own key per date, so queuing twice adds nothing). */
export async function queueNextReviewOverdueCheck(
  db: DbOrTransaction,
  date: string,
  now: Date = new Date(),
): Promise<string> {
  const next = nextDailyRun(now, date, REVIEW_OVERDUE_CHECK_TIME);
  await enqueueJob(db, {
    kind: REVIEW_OVERDUE_JOB,
    payload: { date: next.date },
    runAt: next.runAt,
    idempotencyKey: [REVIEW_OVERDUE_JOB, next.date].join(':'),
  });
  return next.date;
}

/** Whether the episode `e` is overdue its review on `today` (IST) at `now`. */
function overdue(today: string, now: Date): SQL {
  return sql`e.status = 'active'
    and (select p.review_date from public.plan_of_care p
      where p.episode_id = e.id order by p.version desc limit 1) < ${today}::date
    and not exists (select 1 from public.final_test f where f.episode_id = e.id)
    and not exists (
      select 1 from public.appointment a
      join public.appointment_type t on t.id = a.appointment_type_id
      where t.key = 'review'
        -- A Review booked at the desk names no episode: the patient's own, since the opening.
        and (a.episode_id = e.id
          or (a.episode_id is null and a.patient_id = e.patient_id and a.starts_at >= e.opened_at))
        and (a.status in ('checked_in', 'in_progress', 'completed')
          or (a.status in ('booked', 'confirmed') and a.starts_at > ${now.toISOString()}::timestamptz))
    )`;
}

/** An episode overdue its review, with no open task for it yet. */
export interface OverdueReview {
  episodeId: string;
  centreId: string;
  patientId: string;
  reviewDate: string;
  /** The consultant who signed its consultation; none before one is signed. */
  consultantId: string | null;
}

export async function overdueReviews(
  db: DbOrTransaction,
  today: string,
  now: Date,
): Promise<OverdueReview[]> {
  const rows = await db.execute<{
    episode_id: string;
    centre_id: string;
    patient_id: string;
    review_date: string;
    consultant_id: string | null;
  }>(sql`select e.id as episode_id, e.centre_id, e.patient_id,
      (select p.review_date::text from public.plan_of_care p
        where p.episode_id = e.id order by p.version desc limit 1) as review_date,
      (select c.signed_by from public.consultation c
        where c.episode_id = e.id and c.status = 'signed'
        order by c.signed_at desc limit 1) as consultant_id
    from public.episode e
    where ${overdue(today, now)}
      and not exists (select 1 from public.task t
        where t.episode_id = e.id and t.kind = ${REVIEW_OVERDUE_TASK} and t.status = 'open')
    order by e.opened_at`);
  return rows.map((row) => ({
    episodeId: row.episode_id,
    centreId: row.centre_id,
    patientId: row.patient_id,
    reviewDate: row.review_date,
    consultantId: row.consultant_id,
  }));
}

/**
 * The day's check: a task for each episode overdue its review, and the open ones whose review is
 * since booked or done, or whose episode is no longer Active, closed. Running a day twice adds
 * nothing. The episodes flagged.
 */
export async function flagOverdueReviews(
  db: DbOrTransaction,
  today: string,
  now: Date,
): Promise<string[]> {
  await db.execute(sql`update public.task t
    set status = 'closed',
      decision = case
        when exists (select 1 from public.episode e where e.id = t.episode_id and e.status = 'active'
          and not exists (select 1 from public.final_test f where f.episode_id = e.id))
          then 'Closed automatically: the review is booked or done.'
        else 'Closed automatically: the episode is no longer Active, or its final test is done.'
      end,
      closed_at = now(), updated_at = now()
    where t.kind = ${REVIEW_OVERDUE_TASK} and t.status = 'open'
      and not exists (select 1 from public.episode e where e.id = t.episode_id and ${overdue(today, now)})`);
  const flagged: string[] = [];
  for (const late of await overdueReviews(db, today, now)) {
    const made = await db
      .insert(task)
      .values({
        kind: REVIEW_OVERDUE_TASK,
        title: reviewOverdueTitle(late.reviewDate),
        details: { reviewDate: late.reviewDate },
        ...(late.consultantId
          ? { assigneeStaffUserId: late.consultantId }
          : { assigneeRole: 'centre_manager' as const }),
        centreId: late.centreId,
        patientId: late.patientId,
        episodeId: late.episodeId,
      })
      .onConflictDoNothing()
      .returning({ id: task.id });
    if (made.length > 0) flagged.push(late.episodeId);
  }
  return flagged;
}
