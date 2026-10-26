import 'server-only';
import {
  SlotRefusedError,
  addReviewBookingTask,
  appointmentTypeIdByKey,
  bookAppointment,
  freeSlots,
  reviewBookingFacts,
  type Db,
} from '@clinic-mx/db';
import { istDate, reviewSearchDates } from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * The 6 week review (OUT-06, PRD J6.1; docs/runbooks/calendar.md "6 week review"; user decisions
 * 26 October 2026). Run by `review.book`, which the database queues once when the episode turns
 * Active: the Review is booked with the consultant who signed the consultation, at the episode's
 * centre, at their first free time from the plan's review date (or today, once that has passed)
 * within `scheduling.review_search_days`. With no free time, the front desk gets a task. A job
 * that runs again books nothing more.
 */

export type ReviewBookingResult =
  | { status: 'booked'; appointmentId: string; startsAt: Date }
  | { status: 'task' }
  | { status: 'skipped'; reason: string };

const holderOf = (episodeId: string) => `review:${episodeId}`;

export async function runReviewBooking(
  db: Db,
  input: { episodeId: string },
  now: Date = new Date(),
): Promise<ReviewBookingResult> {
  const [step, searchDays] = await Promise.all([
    getSetting('scheduling.slot_minutes'),
    getSetting('scheduling.review_search_days'),
  ]);
  return systemService({
    component: 'scheduling',
    input: z.object({ episodeId: z.guid() }),
    run: async (tx, { episodeId }): Promise<ReviewBookingResult> => {
      const facts = await reviewBookingFacts(tx, episodeId);
      if (!facts) return { status: 'skipped', reason: 'The episode was not found.' };
      if (facts.status !== 'active') return { status: 'skipped', reason: 'Not Active.' };
      if (facts.booked) return { status: 'skipped', reason: 'A review is booked already.' };
      const { reviewDate, consultant } = facts;
      if (!reviewDate || !consultant) {
        return { status: 'skipped', reason: 'No signed plan.' };
      }
      const typeId = await appointmentTypeIdByKey(tx, 'review');
      if (!typeId) return { status: 'skipped', reason: 'No Review appointment type.' };
      const dates = reviewSearchDates(reviewDate, istDate(now), searchDays);
      const holder = holderOf(episodeId);
      for (const date of dates) {
        const [theirs] = await freeSlots(tx, {
          centreId: facts.centreId,
          appointmentTypeId: typeId,
          date,
          physioId: consultant.id,
          holder,
          step,
          now,
        }).catch((error: unknown) => {
          if (error instanceof SlotRefusedError) return [];
          throw error;
        });
        for (const slot of theirs?.slots ?? []) {
          if (slot.startsAt <= now) continue;
          try {
            // A savepoint, so a start taken meanwhile leaves the search going.
            const row = await tx.transaction((sp) =>
              bookAppointment(sp, {
                centreId: facts.centreId,
                physioId: consultant.id,
                appointmentTypeId: typeId,
                startsAt: slot.startsAt,
                holder,
                patientId: facts.patientId,
                episodeId,
                channel: 'automatic',
                step,
                now,
              }),
            );
            return { status: 'booked', appointmentId: row.id, startsAt: slot.startsAt };
          } catch (error) {
            if (!(error instanceof SlotRefusedError)) throw error;
          }
        }
      }
      await addReviewBookingTask(tx, {
        episodeId,
        centreId: facts.centreId,
        patientId: facts.patientId,
        reviewDate,
        searchedTo: dates.at(-1) ?? reviewDate,
        consultant: consultant.name,
      });
      return { status: 'task' };
    },
  })(db, input);
}
