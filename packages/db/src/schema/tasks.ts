import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { episode } from './episodes';
import { centre, staffRole, staffUser } from './identity';
import { patient } from './patients';

/**
 * Tasks (TAD section 4): work for a person or a role, closed only with a recorded decision
 * (PRD M11). FND-10 creates them for failed jobs. ALT-03 is the inbox: a task for a role at a
 * centre reaches that role there; one person may take it ("Take it"), and then only they see it.
 * Tasks are created by the server as the system; staff only take and close them
 * (docs/runbooks/tasks.md).
 */

export const taskPriorities = ['urgent', 'high', 'normal'] as const;
export const taskPriority = pgEnum('task_priority', taskPriorities);

export const taskStatuses = ['open', 'closed'] as const;
export const taskStatus = pgEnum('task_status', taskStatuses);

export const task = pgTable(
  'task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** What kind of work, for example "job.failed" or "call.no_show". */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    /** Ids and facts for the task; no patient names or phone numbers. */
    details: jsonb('details').notNull().default({}),
    priority: taskPriority('priority').notNull().default('normal'),
    status: taskStatus('status').notNull().default('open'),
    /** Assigned to a role (every staff member with it) or to one person. */
    assigneeRole: staffRole('assignee_role'),
    assigneeStaffUserId: uuid('assignee_staff_user_id').references(() => staffUser.id),
    /** When someone took a role task for themselves (ALT-03); null when it was made for them. */
    takenAt: timestamp('taken_at', { withTimezone: true }),
    /** The centre a role task is for; none means every centre (the Super Admin's job tasks). */
    centreId: uuid('centre_id').references(() => centre.id),
    patientId: uuid('patient_id').references(() => patient.id),
    episodeId: uuid('episode_id').references(() => episode.id),
    dueAt: timestamp('due_at', { withTimezone: true }),
    decision: text('decision'),
    closedBy: uuid('closed_by').references(() => staffUser.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('task_open_role_idx')
      .on(table.assigneeRole)
      .where(sql`${table.status} = 'open'`),
    index('task_open_assignee_idx')
      .on(table.assigneeStaffUserId)
      .where(sql`${table.status} = 'open'`),
    index('task_closed_at_idx').on(table.closedAt),
    // One open overdue 6 week review task per episode (ALT-02): the daily check never adds twice.
    uniqueIndex('task_open_review_overdue_key')
      .on(table.episodeId)
      .where(sql`${table.kind} = 'review.overdue' and ${table.status} = 'open'`),
    // One unclosed Part B decline task per episode (BIL-03): two declines at once add one.
    uniqueIndex('task_open_part_b_declined_key')
      .on(table.episodeId)
      .where(sql`${table.kind} = 'consent.part_b_declined' and ${table.status} <> 'closed'`),
    // One open AI spend cap task at a time (AI-01): a capped day never adds a second.
    uniqueIndex('task_open_ai_spend_cap_key')
      .on(table.kind)
      .where(sql`${table.kind} = 'ai.spend_cap' and ${table.status} = 'open'`),
    // An undone no show closes the open tasks it raised (ALT-04).
    index('task_open_appointment_idx')
      .on(sql`(${table.details} ->> 'appointmentId')`)
      .where(sql`${table.status} = 'open'`),
    check(
      'task_has_assignee',
      sql`${table.assigneeRole} is not null or ${table.assigneeStaffUserId} is not null`,
    ),
    // Every task is closed with a decision (PRD M11).
    check(
      'task_closed_with_decision',
      sql`${table.status} <> 'closed' or (${table.decision} is not null and ${table.closedAt} is not null)`,
    ),
  ],
).enableRLS();

export type Task = typeof task.$inferSelect;
