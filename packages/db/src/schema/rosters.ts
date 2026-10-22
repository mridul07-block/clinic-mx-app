import type { Weekly } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { centre, staffUser } from './identity';

/**
 * Rosters and leave (SET-04). A roster row is one version of a person's weekly pattern at one
 * centre, in effect from `effective_from` until their next version there; earlier weeks keep the
 * pattern they had. `weekly` holds seven arrays of IST blocks, Monday first, checked by the
 * service. Leave is a span of UTC instants; requested and approved leave never overlap for one
 * person (an exclusion constraint in the rules migration).
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const roster = pgTable(
  'roster',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUser.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    effectiveFrom: date('effective_from').notNull(),
    weekly: jsonb('weekly').$type<Weekly>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => staffUser.id),
    ...timestamps,
  },
  (table) => [
    unique('roster_version_key').on(table.staffUserId, table.centreId, table.effectiveFrom),
    index('roster_centre_idx').on(table.centreId),
    check(
      'roster_weekly_week',
      sql`jsonb_typeof(${table.weekly}) = 'array' and jsonb_array_length(${table.weekly}) = 7`,
    ),
  ],
).enableRLS();

export const leaveStatuses = ['requested', 'approved', 'declined', 'cancelled'] as const;
export const leaveStatus = pgEnum('leave_status', leaveStatuses);

export const staffLeave = pgTable(
  'staff_leave',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUser.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Whole IST days, shown as dates; otherwise part of a day, shown with times. */
    allDay: boolean('all_day').notNull(),
    note: text('note'),
    status: leaveStatus('status').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => staffUser.id),
    decidedBy: uuid('decided_by').references(() => staffUser.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    declineReason: text('decline_reason'),
    ...timestamps,
  },
  (table) => [
    index('staff_leave_staff_idx').on(table.staffUserId, table.startsAt),
    check('staff_leave_span', sql`${table.endsAt} > ${table.startsAt}`),
    check('staff_leave_note', sql`${table.note} is null or length(${table.note}) <= 200`),
    // Requested leave has no decision; approved and declined leave have one; cancelled leave may
    // (a manager may cancel approved leave).
    check(
      'staff_leave_decided',
      sql`(${table.status} <> 'requested' or ${table.decidedBy} is null)
        and (${table.status} not in ('approved', 'declined') or ${table.decidedBy} is not null)
        and (${table.decidedBy} is null) = (${table.decidedAt} is null)`,
    ),
    check(
      'staff_leave_declined',
      sql`(${table.status} = 'declined') = (${table.declineReason} is not null)`,
    ),
  ],
).enableRLS();

export type Roster = typeof roster.$inferSelect;
export type StaffLeave = typeof staffLeave.$inferSelect;
