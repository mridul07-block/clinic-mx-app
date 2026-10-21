import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { staffRole, staffUser } from './identity';

/**
 * Tasks (TAD section 4): work for a person or a role, closed only with a recorded decision
 * (PRD M11). FND-10 creates them for failed jobs; the tasks inbox is ALT-03, and the links to
 * episodes and patients arrive with those tables.
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
