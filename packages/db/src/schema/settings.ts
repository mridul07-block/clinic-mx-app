import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Settings (FND-14, rule 6): one row per business rule the Super Admin can change. Keys and
 * value shapes are defined in `@clinic-mx/schemas` (settings.ts); the values are inserted by
 * migration and read through the cached settings reader.
 */
export const setting = pgTable(
  'setting',
  {
    /** For example "day.running_late_minutes". */
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    /** The actor of the last change, as in the audit trail ("staff:<id>", "system:migration"). */
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('setting_key_format', sql`${table.key} ~ '^[a-z]+[.][a-z0-9_]+$'`)],
).enableRLS();

export type SettingRow = typeof setting.$inferSelect;
