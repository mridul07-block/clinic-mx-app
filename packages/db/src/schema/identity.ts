import { staffRoles } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Identity: centres, staff and which centres each staff member works in (TAD section 4).
 * Every table has row level security on and, until IAM-05 adds policies, no policies, so
 * the Supabase API roles (anon, authenticated) read nothing. The server connects as the
 * database owner, which bypasses RLS.
 */

/** All times are stored in UTC (rule 15); `timestamptz` keeps the offset explicit. */
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const staffRole = pgEnum('staff_role', staffRoles);

export const centre = pgTable(
  'centre',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    address: text('address'),
    mapLink: text('map_link'),
    phone: text('phone'),
    /** Chart colour only (Frontend Specification); never used to show status. */
    colour: text('colour').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [check('centre_colour_hex', sql`${table.colour} ~ '^#[0-9A-F]{6}$'`)],
).enableRLS();

export const staffUser = pgTable(
  'staff_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The Supabase Auth user; linked when the login is created (IAM-01). */
    authUserId: uuid('auth_user_id').unique(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: staffRole('role').notNull(),
    treatsPatients: boolean('treats_patients').notNull().default(false),
    consultant: boolean('consultant').notNull().default(false),
    active: boolean('active').notNull().default(true),
    /** Access stops at this moment; null means no end date. */
    accessEndsAt: timestamp('access_ends_at', { withTimezone: true }),
    /**
     * A Velyx support login (IAM-08): signs in only while support access is granted, and is read
     * only. It sees what the Super Admin sees, without ticks, so never clinical records.
     */
    velyxSupport: boolean('velyx_support').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('staff_user_email_lower_key').on(sql`lower(${table.email})`),
    // Decision G5: the Consultant tick requires Treats patients, and physios always treat.
    check('staff_user_consultant_treats', sql`not ${table.consultant} or ${table.treatsPatients}`),
    check(
      'staff_user_physio_treats',
      sql`${table.role} <> 'physiotherapist' or ${table.treatsPatients}`,
    ),
    check(
      'staff_user_support_super_admin',
      sql`not ${table.velyxSupport} or (${table.role} = 'super_admin' and not ${table.treatsPatients})`,
    ),
  ],
).enableRLS();

/**
 * Centres a staff member is assigned to. Super Admin and Finance see every centre by role
 * (PRD section 2), so they need no rows here.
 */
export const staffUserCentre = pgTable(
  'staff_user_centre',
  {
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUser.id, { onDelete: 'cascade' }),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.staffUserId, table.centreId] }),
    index('staff_user_centre_centre_id_idx').on(table.centreId),
  ],
).enableRLS();

export type Centre = typeof centre.$inferSelect;
export type NewCentre = typeof centre.$inferInsert;
export type StaffUser = typeof staffUser.$inferSelect;
export type NewStaffUser = typeof staffUser.$inferInsert;
export type NewStaffUserCentre = typeof staffUserCentre.$inferInsert;
