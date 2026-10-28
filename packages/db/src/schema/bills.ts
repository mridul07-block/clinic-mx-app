import { billKinds, billStatuses, paymentMethods } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appointment } from './appointments';
import { episode } from './episodes';
import { centre, staffUser } from './identity';
import { patient } from './patients';
import { patientPlanChoice } from './plan-choices';
import { discountKind, discountPreset, packageType, priceItem } from './prices';

export const billKind = pgEnum('bill_kind', billKinds);

/** A bill line as a payment charged it (BIL-07). */
export interface ChargedLine {
  description: string;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
  discount: { name: string; percent: number | null; paise: number } | null;
}
export const billStatus = pgEnum('bill_status', billStatuses);

/**
 * A bill (BIL-05, TAD section 4): made by the database at the price master's amounts, never by a
 * person typing a price. The consultation fee's names its appointment, a package's the patient's
 * choice. Staff read bills at their centre if they see amounts; nobody signed in adds, changes or
 * deletes one. A bill no longer wanted is cancelled with its reason, never removed.
 */
export const bill = pgTable(
  'bill',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The centre's code, "B" and its next number, for example HSR-B-00001. */
    number: text('number').notNull().unique(),
    kind: billKind('kind').notNull(),
    status: billStatus('status').notNull().default('unpaid'),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    episodeId: uuid('episode_id').references(() => episode.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    appointmentId: uuid('appointment_id').references(() => appointment.id),
    planChoiceId: uuid('plan_choice_id').references(() => patientPlanChoice.id),
    totalPaise: integer('total_paise').notNull(),
    /** Whose action made it (the check in, the signing, the choice); none when the system did. */
    createdBy: uuid('created_by').references(() => staffUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
  },
  (table) => [
    index('bill_episode_idx').on(table.episodeId, table.createdAt),
    uniqueIndex('bill_live_consultation_key')
      .on(table.appointmentId)
      .where(sql`${table.kind} = 'consultation' and ${table.status} <> 'cancelled'`),
    uniqueIndex('bill_choice_key').on(table.planChoiceId),
    check(
      'bill_source',
      sql`case ${table.kind}
        when 'consultation' then ${table.appointmentId} is not null and ${table.planChoiceId} is null
        else ${table.planChoiceId} is not null and ${table.appointmentId} is null
      end`,
    ),
    check('bill_total', sql`${table.totalPaise} >= 0`),
    check(
      'bill_cancelled',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null and ${table.cancelReason} is not null)`,
    ),
  ],
).enableRLS();

/**
 * A line of a bill, copied from the price master when the bill is made. A discount (BIL-07) is
 * kept on the line with a copy of what it was (a preset's name and percent, or Finance's "Other
 * discount" with its reason) and who applied it; the bill's total is the lines less their
 * discounts. Only `internal.apply_discount` and `internal.remove_discount` write them.
 */
export const billLine = pgTable(
  'bill_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bill.id),
    priceItemId: uuid('price_item_id').references(() => priceItem.id),
    packageTypeId: uuid('package_type_id').references(() => packageType.id),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPaise: integer('unit_paise').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    discountKind: discountKind('discount_kind'),
    /** The preset applied; none for an Other discount (Finance or the Super Admin). */
    discountPresetId: uuid('discount_preset_id').references(() => discountPreset.id),
    /** The preset's name when applied, or "Other discount". */
    discountName: text('discount_name'),
    discountPercent: integer('discount_percent'),
    discountPaise: integer('discount_paise').notNull().default(0),
    discountReason: text('discount_reason'),
    discountedBy: uuid('discounted_by').references(() => staffUser.id),
    /** Their name when applied, so everyone who reads the bill sees who approved it. */
    discountedByName: text('discounted_by_name'),
    discountedAt: timestamp('discounted_at', { withTimezone: true }),
  },
  (table) => [
    index('bill_line_bill_idx').on(table.billId),
    check(
      'bill_line_item',
      sql`(${table.priceItemId} is null) <> (${table.packageTypeId} is null)`,
    ),
    check('bill_line_quantity', sql`${table.quantity} > 0`),
    check('bill_line_amount', sql`${table.amountPaise} = ${table.quantity} * ${table.unitPaise}`),
    check(
      'bill_line_discount',
      sql`case
        when ${table.discountKind} is null then ${table.discountPaise} = 0
          and ${table.discountPresetId} is null and ${table.discountName} is null
          and ${table.discountPercent} is null and ${table.discountReason} is null
          and ${table.discountedBy} is null and ${table.discountedAt} is null
        else ${table.discountPaise} >= 1 and ${table.discountPaise} < ${table.amountPaise}
          and ${table.discountedBy} is not null and ${table.discountedAt} is not null
          and length(trim(${table.discountName})) between 1 and 60
          and (${table.discountPresetId} is not null
            or length(trim(${table.discountReason})) between 1 and 300)
          and case ${table.discountKind}
            when 'percent' then ${table.discountPercent} between 1 and 100
              and ${table.discountPaise} = (${table.amountPaise}::bigint * ${table.discountPercent} + 50) / 100
            else ${table.discountPercent} is null
          end
      end`,
    ),
  ],
).enableRLS();

export const paymentMethod = pgEnum('payment_method', paymentMethods);

/**
 * A payment at the counter (BIL-06, TAD section 4): the bill's whole total by UPI QR, card or
 * cash, with an optional reference, recorded by the database for the person at the desk. Nobody
 * signed in writes one directly. A payment recorded by mistake is undone on its day with a reason,
 * never deleted; one live payment per bill.
 */
export const payment = pgTable(
  'payment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bill.id),
    method: paymentMethod('method').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    /** The UPI transaction ID or the card slip number, when given. */
    reference: text('reference'),
    /**
     * Its invoice's number (BIL-09): the centre's code, "INV" and its next invoice number, given
     * when the payment is recorded, so invoices run without gaps. None before BIL-09.
     */
    invoiceNumber: text('invoice_number').unique(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => staffUser.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneBy: uuid('undone_by').references(() => staffUser.id),
    undoReason: text('undo_reason'),
    /**
     * The lines as they were charged, discounts included (BIL-07): the invoice prints these, so a
     * payment undone and a bill discounted again never changes an earlier invoice.
     */
    chargedLines: jsonb('charged_lines').$type<ChargedLine[]>(),
  },
  (table) => [
    uniqueIndex('payment_live_key')
      .on(table.billId)
      .where(sql`${table.undoneAt} is null`),
    check('payment_amount', sql`${table.amountPaise} > 0`),
    check('payment_reference', sql`${table.reference} is null or length(${table.reference}) <= 40`),
    check(
      'payment_undone',
      sql`(${table.undoneAt} is null) = (${table.undoneBy} is null) and (${table.undoneAt} is null) = (${table.undoReason} is null)`,
    ),
  ],
).enableRLS();

export type Payment = typeof payment.$inferSelect;
export type Bill = typeof bill.$inferSelect;
export type BillLine = typeof billLine.$inferSelect;
