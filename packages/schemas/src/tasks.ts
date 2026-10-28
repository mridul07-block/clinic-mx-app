import { z } from 'zod';
import { addDays, istDate, istInstant } from './ist';
import { parseTime } from './rosters';

/**
 * The tasks inbox (ALT-03, PRD M11): tasks by urgency; one person may take a role task; every task
 * is closed with a written decision. Tasks are made by the server; each kind is named here.
 */

export const taskPriorities = ['urgent', 'high', 'normal'] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const taskPriorityLabels: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
};

/** What each kind of task is, as its card says. Tickets that make a new kind add it here. */
export const taskKindLabels: Record<string, string> = {
  'job.failed': 'Background job failed',
  'call.no_show': 'Call after a no show',
  'review.no_shows': 'Clinical review: missed appointments',
  'call.think_about_it': 'Call about a proposed plan',
  'review.new_symptoms': 'Clinical review: new symptoms',
  'review.adverse_event': 'Clinical review: adverse event',
  'review.adverse_event_director': 'Adverse event: Clinical Director review',
  'review.unsigned_notes': 'Unsigned notes',
  'book.review': 'Book the 6 week review',
  'review.reassessment': 'Reassessment review',
  'review.lost_to_follow_up': 'Lost to follow up',
  'review.worsening': 'Clinical review: worse or escalated',
  'review.overdue': '6 week review overdue',
};

export function taskKindLabel(kind: string): string {
  return taskKindLabels[kind] ?? 'Task';
}

export const taskIdSchema = z.uuid({ error: 'That task was not found.' });

export const takeTaskSchema = z.object({ taskId: taskIdSchema });

export const closeTaskSchema = z.object({
  taskId: taskIdSchema,
  decision: z
    .string()
    .trim()
    .min(1, { error: 'Write the decision before closing.' })
    .max(1000, { error: 'Keep the decision under 1000 characters.' }),
});

export type TakeTaskInput = z.infer<typeof takeTaskSchema>;
export type CloseTaskInput = z.infer<typeof closeTaskSchema>;

/**
 * The unsigned notes flag (CLN-10): every night at 9:00 PM IST (TAD job table; PRD section 7 marks
 * it Fixed, so it is not a setting) each centre's Centre Manager gets the notes still unsigned.
 */
export const UNSIGNED_NOTES_FLAG_TIME = '21:00';

/** The task kind of the unsigned notes flag. */
export const UNSIGNED_NOTES_TASK = 'review.unsigned_notes';

/**
 * The IST date of the flag's next run after one for `date`: the next 9 PM after now, never on or
 * before `date`. A run late after downtime catches up to tonight, never every missed night.
 */
export function nextUnsignedNotesRun(now: Date, date: string): { date: string; runAt: Date } {
  return nextDailyRun(now, date, UNSIGNED_NOTES_FLAG_TIME);
}

/**
 * The IST date of a daily job's next run at `time` after one for `date`: the next `time` after
 * now, never on or before `date`, so a late run catches up to today, never every missed day.
 */
export function nextDailyRun(now: Date, date: string, time: string): { date: string; runAt: Date } {
  const minutes = parseTime(time);
  if (minutes === undefined) throw new Error(`Not a time of day: ${time}`);
  const today = istDate(now);
  let next = now < istInstant(today, minutes) ? today : addDays(today, 1);
  if (next <= date) next = addDays(date, 1);
  return { date: next, runAt: istInstant(next, minutes) };
}

/** The task's title, for example "Unsigned notes: 3 at HSR Layout". */
export function unsignedNotesTitle(count: number, centreName: string): string {
  return `Unsigned ${count === 1 ? 'note' : 'notes'}: ${String(count)} at ${centreName}`;
}

/** One unsigned note as the task carries it: no patient, only the visit and the physio. */
export const unsignedNoteSchema = z.object({
  kind: z.enum(['consultation', 'session']),
  number: z.string(),
  physio: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
});

export type UnsignedNote = z.infer<typeof unsignedNoteSchema>;

/** The front desk's task when the 6 week review could not be booked automatically (OUT-06). */
export const REVIEW_BOOKING_TASK = 'book.review';

export const reviewToBookSchema = z.object({
  reviewDate: z.iso.date(),
  searchedTo: z.iso.date(),
  consultant: z.string(),
});

export type ReviewToBook = z.infer<typeof reviewToBookSchema>;

/** What a review booking task says; undefined when it cannot be read. */
export function reviewToBookOf(details: Record<string, unknown>): ReviewToBook | undefined {
  const parsed = reviewToBookSchema.safeParse(details);
  return parsed.success ? parsed.data : undefined;
}

/** The notes in an unsigned notes task's details; none when they cannot be read. */
export function unsignedNotesOf(details: Record<string, unknown>): UnsignedNote[] {
  const parsed = z.array(unsignedNoteSchema).safeParse(details.notes);
  return parsed.success ? parsed.data : [];
}
