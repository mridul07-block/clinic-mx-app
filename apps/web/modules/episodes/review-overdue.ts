import 'server-only';
import { flagOverdueReviews, queueNextReviewOverdueCheck, type Db } from '@clinic-mx/db';
import { istDate } from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';

/**
 * The overdue 6 week review check (ALT-02; docs/runbooks/tasks.md): the daily job queues the next
 * day first, in its own transaction, so a failed day never breaks the chain; then each Active
 * episode past its review date with no Review attended or booked ahead and no final test gets a
 * task for the consultant, and open ones no longer due are closed.
 */

const day = z.object({ date: z.iso.date() });

const queueNext = systemService({
  component: 'episodes',
  input: day,
  run: (tx, { date }) => queueNextReviewOverdueCheck(tx, date),
});

/** The day's run: the next day queued, then the check. The episodes flagged. */
export async function runReviewOverdueCheck(db: Db, input: { date: string }) {
  await queueNext(db, input);
  return systemService({
    component: 'episodes',
    input: day,
    run: (tx) => {
      const now = new Date();
      return flagOverdueReviews(tx, istDate(now), now);
    },
  })(db, input);
}
