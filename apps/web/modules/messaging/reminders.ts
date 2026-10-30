import 'server-only';
import {
  DAY_BEFORE_REMINDERS_JOB,
  MORNING_REMINDERS_JOB,
  queueNextReminders,
  type Db,
} from '@clinic-mx/db';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { sendDayBeforeReminders, sendMorningReminders } from './clinic-messages';

/**
 * The appointment reminders' daily runs (WA-08; docs/runbooks/whatsapp.md, "Reminders"): each run
 * queues the next one first, in its own transaction at the setting's time as it is now, so a
 * failed day never breaks the chain; then it queues the day's messages.
 */

const queueNext = systemService({
  component: 'whatsapp',
  input: z.object({
    kind: z.enum([DAY_BEFORE_REMINDERS_JOB, MORNING_REMINDERS_JOB]),
    date: z.iso.date(),
    time: z.string(),
  }),
  run: (tx, { kind, date, time }) => queueNextReminders(tx, kind, date, time),
});

/** The evening's run for `date`'s appointments: the next evening queued, then the reminders. */
export async function runDayBeforeReminders(db: Db, input: { date: string }): Promise<number> {
  const time = await getSetting('reminders.day_before_time');
  await queueNext(db, { kind: DAY_BEFORE_REMINDERS_JOB, date: input.date, time });
  return sendDayBeforeReminders(db, { date: input.date, now: new Date() });
}

/** The morning's run for `date`: the next morning queued, then the reminders. */
export async function runMorningReminders(db: Db, input: { date: string }): Promise<number> {
  const time = await getSetting('reminders.morning_time');
  await queueNext(db, { kind: MORNING_REMINDERS_JOB, date: input.date, time });
  return sendMorningReminders(db, { date: input.date, now: new Date() });
}
