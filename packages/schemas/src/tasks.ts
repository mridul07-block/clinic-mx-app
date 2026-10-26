import { z } from 'zod';

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
