import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bill, payment } from './bills';
import { episode } from './episodes';
import { centre } from './identity';
import { patient } from './patients';
import { packageType } from './prices';

/**
 * A patient's package (BIL-08, TAD section 4, PRD J4.7): made by the database when the package's
 * bill is paid, with the type's sessions, valid until `packages.validity_months` after the payment
 * date and its reschedule allowance; closing a treatment session uses one (SES-07). It holds no
 * amounts, so physios read it for the sessions left (decision 21 October 2026). Nobody signed in
 * writes one; undoing the payment cancels it while no session has been used. Its state (active,
 * used up, expired, cancelled) is worked out from the row (`packageState`).
 */
export const patientPackage = pgTable(
  'package',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    packageTypeId: uuid('package_type_id')
      .notNull()
      .references(() => packageType.id),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bill.id),
    paymentId: uuid('payment_id')
      .notNull()
      .unique()
      .references(() => payment.id),
    /** The package type's name when it was bought, so reading it needs no price list. */
    name: text('name').notNull(),
    sessionsTotal: integer('sessions_total').notNull(),
    sessionsUsed: integer('sessions_used').notNull().default(0),
    reschedulesLeft: integer('reschedules_left').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    /** The last IST day it can be used. */
    validUntil: date('valid_until').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
  },
  (table) => [
    uniqueIndex('package_live_key')
      .on(table.billId)
      .where(sql`${table.cancelledAt} is null`),
    index('package_episode_idx').on(table.episodeId),
    index('package_patient_idx').on(table.patientId),
    check(
      'package_sessions',
      sql`${table.sessionsTotal} >= 1 and ${table.sessionsUsed} between 0 and ${table.sessionsTotal}`,
    ),
    check('package_reschedules', sql`${table.reschedulesLeft} >= 0`),
    check(
      'package_cancelled',
      sql`(${table.cancelledAt} is null) = (${table.cancelReason} is null)`,
    ),
  ],
).enableRLS();

export type PatientPackage = typeof patientPackage.$inferSelect;
