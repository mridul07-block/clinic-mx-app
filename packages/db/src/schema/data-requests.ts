import { sql } from 'drizzle-orm';
import { check, date, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { staffUser } from './identity';
import { patient } from './patients';

/**
 * A patient's request about their data (ADM-03; PRD M16 "data export and deletion requests"; TAD
 * section 5, DPDP Act 2023: "data export and deletion requests handled by the Super Admin"). The
 * Super Admin records it with what was asked and when, it is due a set number of days later
 * (`privacy.request_response_days`), and it is closed once, done or declined, with what was done.
 * A closed request never changes. Deletion itself waits for the clinic's retention period (PRD
 * decision 20).
 */
export const dataRequestKinds = ['export', 'correction', 'deletion'] as const;
export const dataRequestKind = pgEnum('data_request_kind', dataRequestKinds);

export const dataRequestStatuses = ['open', 'done', 'declined'] as const;
export const dataRequestStatus = pgEnum('data_request_status', dataRequestStatuses);

export const dataRequest = pgTable(
  'data_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    kind: dataRequestKind('kind').notNull(),
    /** The day it reached the clinic (IST), as the patient dated it or as received. */
    receivedOn: date('received_on').notNull(),
    /** When the clinic answers by: the received day plus the setting's days, fixed when recorded. */
    dueOn: date('due_on').notNull(),
    /** What the patient asked, in the Super Admin's words. */
    details: text('details').notNull(),
    status: dataRequestStatus('status').notNull().default('open'),
    /** What was done, or why it was declined; written when it is closed. */
    outcome: text('outcome'),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => staffUser.id),
    closedBy: uuid('closed_by').references(() => staffUser.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('data_request_open_idx').on(table.status, table.dueOn),
    index('data_request_patient_idx').on(table.patientId),
    check('data_request_due_after_received', sql`${table.dueOn} >= ${table.receivedOn}`),
    check('data_request_details_length', sql`char_length(${table.details}) BETWEEN 1 AND 2000`),
    check(
      'data_request_closed',
      sql`(${table.status} = 'open') = (${table.closedAt} IS NULL)
        AND (${table.status} = 'open') = (${table.closedBy} IS NULL)
        AND (${table.status} = 'open' OR char_length(coalesce(${table.outcome}, '')) BETWEEN 1 AND 2000)`,
    ),
  ],
).enableRLS();

export type DataRequestRow = typeof dataRequest.$inferSelect;
