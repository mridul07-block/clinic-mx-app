import { addDays, istDate } from './ist';
import { nextDailyRun } from './tasks';

/**
 * The appointment reminders (WA-08; PRD J1.6; TAD section 8): the day before reminder at
 * `reminders.day_before_time` (6:00 PM IST) for the next day's appointments, with Confirm and
 * Reschedule, and the reminder at `reminders.morning_time` (8:00 AM IST) on the day, to every
 * patient. Each is a daily job keyed by the appointments' IST date. A booking made after the
 * evening's run gets no day before reminder; the morning one still reaches it (user decision,
 * 31 October 2026).
 */

/**
 * The day before run after the one for `date`'s appointments: the next evening at `time` after
 * now, for the day after that evening. A late run catches up to tonight, never every missed day.
 */
export function nextDayBeforeRun(now: Date, date: string, time: string) {
  const evening = nextDailyRun(now, addDays(date, -1), time);
  return { date: addDays(evening.date, 1), runAt: evening.runAt };
}

/** The morning run after the one for `date`: the next morning at `time` after now. */
export function nextMorningRun(now: Date, date: string, time: string) {
  return nextDailyRun(now, date, time);
}

/**
 * Whether the day before run for `date` still sends: only before that day begins in IST. A run
 * held up past midnight leaves the day to the morning reminder.
 */
export function dayBeforeRunDue(now: Date, date: string): boolean {
  return istDate(now) < date;
}

/** The answer to the day before reminder's Confirm (user decision, 31 October 2026). */
export function appointmentConfirmedText(when: { date: string; time: string }): string {
  return `Thank you, your appointment on ${when.date} at ${when.time} is confirmed.`;
}

/** The answer to a Confirm for an appointment moved, cancelled or started since, before the contact details. */
export const APPOINTMENT_CHANGED_TEXT =
  'This appointment has changed, so it cannot be confirmed here.';
