import { discountKinds } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The price master (SET-02, TAD section 4): list prices, package types and preset discounts.
 * Money is integer paise (rule 15). Nothing is deleted; rows are deactivated, and the audit log
 * keeps every earlier price. Bills copy the amount when they are made (BIL-05), so an edit never
 * changes a bill already made.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

const named = (column: string) => sql.raw(`length(trim(${column})) between 1 and 60`);

export const priceItem = pgTable(
  'price_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Made from the label when the item is added and never changed; settings refer to it. */
    key: text('key').notNull().unique(),
    label: text('label').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check('price_item_key', sql`${table.key} ~ '^[a-z][a-z0-9_]*$'`),
    check('price_item_label', named('label')),
    check('price_item_amount', sql`${table.amountPaise} > 0`),
    uniqueIndex('price_item_label_lower_key').on(sql`lower(${table.label})`),
  ],
).enableRLS();

export const packageType = pgTable(
  'package_type',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sessions: integer('sessions').notNull(),
    /** The whole package's price, entered by Finance (user decision, 22 October 2026). */
    pricePaise: integer('price_paise').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check('package_type_name', named('name')),
    check('package_type_sessions', sql`${table.sessions} >= 1`),
    check('package_type_price', sql`${table.pricePaise} > 0`),
    uniqueIndex('package_type_name_lower_key').on(sql`lower(${table.name})`),
  ],
).enableRLS();

/** The price items a package type covers (TAD `covered_items`; decision 8 says which). */
export const packageTypeItem = pgTable(
  'package_type_item',
  {
    packageTypeId: uuid('package_type_id')
      .notNull()
      .references(() => packageType.id),
    priceItemId: uuid('price_item_id')
      .notNull()
      .references(() => priceItem.id),
  },
  (table) => [
    primaryKey({ columns: [table.packageTypeId, table.priceItemId] }),
    index('package_type_item_price_item_idx').on(table.priceItemId),
  ],
).enableRLS();

export const discountKind = pgEnum('discount_kind', discountKinds);

export const discountPreset = pgTable(
  'discount_preset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: discountKind('kind').notNull(),
    /** A whole percent, for a percent discount. */
    percent: integer('percent'),
    /** A flat amount off, for a flat discount. */
    amountPaise: integer('amount_paise'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    check('discount_preset_name', named('name')),
    check(
      'discount_preset_amount',
      sql`(${table.kind} = 'percent' and ${table.percent} between 1 and 100 and ${table.amountPaise} is null)
        or (${table.kind} = 'flat' and ${table.amountPaise} > 0 and ${table.percent} is null)`,
    ),
    uniqueIndex('discount_preset_name_lower_key').on(sql`lower(${table.name})`),
  ],
).enableRLS();

export type PriceItem = typeof priceItem.$inferSelect;
export type PackageType = typeof packageType.$inferSelect;
export type DiscountPreset = typeof discountPreset.$inferSelect;
