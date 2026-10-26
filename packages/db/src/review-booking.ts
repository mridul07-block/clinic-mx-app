import { REVIEW_BOOKING_TASK, type EpisodeStatus, type ReviewToBook } from '@clinic-mx/schemas';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import {
  appointment,
  appointmentType,
  consultation,
  episode,
  planOfCare,
  staffUser,
  task,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The 6 week review (OUT-06, PRD J6.1; docs/runbooks/calendar.md "6 week review"). When an episode
 * turns Active the database queues `review.book` once; the job books the Review with the
 * consultant who signed the consultation, or gives the front desk a task. User decisions, 26
 * October 2026.
 */

export const REVIEW_BOOK_JOB = 'review.book';

export interface ReviewBookingFacts {
  status: EpisodeStatus;
  centreId: string;
  patientId: string;
  /** The newest plan's review date; null without a plan. */
  reviewDate: string | null;
  /** Who signed the episode's newest signed consultation; null without one. */
  consultant: { id: string; name: string } | null;
  /** Whether a Review that is not cancelled or moved is already booked in the episode. */
  booked: boolean;
}

/** What booking an episode's review needs; undefined when the episode is not found. */
export async function reviewBookingFacts(
  db: DbOrTransaction,
  episodeId: string,
): Promise<ReviewBookingFacts | undefined> {
  const [found] = await db
    .select({ status: episode.status, centreId: episode.centreId, patientId: episode.patientId })
    .from(episode)
    .where(eq(episode.id, episodeId));
  if (!found) return undefined;
  const [plan] = await db
    .select({ reviewDate: planOfCare.reviewDate })
    .from(planOfCare)
    .where(eq(planOfCare.episodeId, episodeId))
    .orderBy(desc(planOfCare.version))
    .limit(1);
  const [signer] = await db
    .select({ id: staffUser.id, name: staffUser.name })
    .from(consultation)
    .innerJoin(staffUser, eq(staffUser.id, consultation.signedBy))
    .where(and(eq(consultation.episodeId, episodeId), eq(consultation.status, 'signed')))
    .orderBy(desc(consultation.signedAt))
    .limit(1);
  const reviews = await db
    .select({ id: appointment.id })
    .from(appointment)
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(
      and(
        eq(appointment.episodeId, episodeId),
        eq(appointmentType.key, 'review'),
        notInArray(appointment.status, ['cancelled', 'rescheduled']),
      ),
    )
    .limit(1);
  return {
    ...found,
    reviewDate: plan?.reviewDate ?? null,
    consultant: signer ?? null,
    booked: reviews.length > 0,
  };
}

/** The front desk's task at the centre when no free time was found for the review. */
export async function addReviewBookingTask(
  db: DbOrTransaction,
  values: { episodeId: string; centreId: string; patientId: string } & ReviewToBook,
): Promise<void> {
  const { episodeId, centreId, patientId, ...details } = values;
  await db.insert(task).values({
    kind: REVIEW_BOOKING_TASK,
    title: 'Book the 6 week review',
    details,
    assigneeRole: 'front_desk',
    centreId,
    patientId,
    episodeId,
  });
}
