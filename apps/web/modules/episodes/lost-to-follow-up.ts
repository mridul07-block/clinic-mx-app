import 'server-only';
import { markLostToFollowUp, queueNextLostToFollowUpCheck, type Db } from '@clinic-mx/db';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * The lost to follow up check (OUT-10; docs/runbooks/sessions.md): the daily job queues the next
 * day first, in its own transaction, so a failed day never breaks the chain; then each episode
 * nobody has attended for `clinical.lost_to_follow_up_days`, with nothing booked ahead, becomes
 * Lost to follow up with a task for the consultant. It never discharges (the database refuses).
 */

const day = z.object({ date: z.iso.date() });

const queueNext = systemService({
  component: 'episodes',
  input: day,
  run: (tx, { date }) => queueNextLostToFollowUpCheck(tx, date),
});

/** The day's run: the next day queued, then the check. The episodes marked. */
export async function runLostToFollowUpCheck(db: Db, input: { date: string }) {
  await queueNext(db, input);
  const days = await getSetting('clinical.lost_to_follow_up_days');
  return systemService({
    component: 'episodes',
    input: day,
    run: (tx) => markLostToFollowUp(tx, new Date(), days),
  })(db, input);
}
