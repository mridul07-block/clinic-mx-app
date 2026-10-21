import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { centre, staffUser } from './identity';
import { patientLink } from './patient-links';

/**
 * Clinic tablets in kiosk mode (IAM-10). A staff member with check in rights sets a tablet up as
 * a centre's kiosk; the tablet then holds a random token in a cookie, and only its sha256 is
 * kept here, so a copy of the table cannot act as a kiosk. `current_link_id` is the form the
 * front desk sent to it; the tablet opens only that one. Stopping a tablet ends its kiosk mode.
 * Audited like every table: set up is an insert; send, reset and stop are updates.
 */
export const kioskDevice = pgTable(
  'kiosk_device',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => staffUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    stoppedBy: uuid('stopped_by').references(() => staffUser.id),
    /** The form sent to the tablet, until it resets or another is sent. */
    currentLinkId: uuid('current_link_id').references(() => patientLink.id),
    currentSince: timestamp('current_since', { withTimezone: true }),
  },
  (table) => [
    index('kiosk_device_centre_idx').on(table.centreId),
    check('kiosk_device_name', sql`length(trim(${table.name})) between 1 and 60`),
    check('kiosk_device_token_hash', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'kiosk_device_stopped',
      sql`(${table.stoppedAt} is null) = (${table.stoppedBy} is null)
        and (${table.stoppedAt} is null or ${table.currentLinkId} is null)`,
    ),
    check(
      'kiosk_device_current',
      sql`(${table.currentLinkId} is null) = (${table.currentSince} is null)`,
    ),
  ],
).enableRLS();

export type KioskDevice = typeof kioskDevice.$inferSelect;
