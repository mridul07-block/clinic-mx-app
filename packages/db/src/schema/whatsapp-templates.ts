import { templateApprovalStatuses } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const templateApprovalStatus = pgEnum('template_approval_status', templateApprovalStatuses);

/**
 * What Meta decided about each template version on this environment's WhatsApp number (WA-06;
 * TAD section 6 template registry). The text lives in code (`message-templates.ts`); whether it
 * may be sent depends on the number, so it lives here: the submit script records each version it
 * submits, and Meta's template webhook moves it on (Approved, Rejected with a reason, Paused,
 * Disabled; a category Meta changed). Only an Approved version is sent. The Super Admin reads it;
 * only the server writes it (`system:whatsapp-templates`, `system:whatsapp`), audited.
 */
export const whatsappTemplate = pgTable(
  'whatsapp_template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The registry key. */
    key: text('key').notNull(),
    version: smallint('version').notNull(),
    language: text('language').notNull(),
    /** Its name on Meta: `<key>_v<version>`. */
    metaName: text('meta_name').notNull(),
    /** Meta's template id, from the submission. */
    metaId: text('meta_id').notNull().unique(),
    /** Meta's category: UTILITY as submitted, unless Meta moved it. */
    category: text('category').notNull(),
    status: templateApprovalStatus('status').notNull().default('pending'),
    /** Meta's reason for a rejection, pause or category change. */
    reason: text('reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('whatsapp_template_version').on(table.key, table.version, table.language),
    unique('whatsapp_template_meta_name').on(table.metaName, table.language),
    check('whatsapp_template_version_positive', sql`${table.version} >= 1`),
    check(
      'whatsapp_template_meta_name_format',
      sql`${table.metaName} = ${table.key} || '_v' || ${table.version}`,
    ),
    check('whatsapp_template_key', sql`${table.key} ~ '^[a-z][a-z0-9_]*$'`),
    // Meta's language codes, for example en or en_US: a typo would never match a send.
    check('whatsapp_template_language', sql`${table.language} ~ '^[a-z]{2,3}(_[A-Z]{2})?$'`),
    check('whatsapp_template_meta_id', sql`${table.metaId} ~ '^[0-9]+$'`),
  ],
).enableRLS();

export type WhatsappTemplate = typeof whatsappTemplate.$inferSelect;
