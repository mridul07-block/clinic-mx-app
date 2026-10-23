import { reportContentTypes } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appointment } from './appointments';
import { staffUser } from './identity';
import { patientLink } from './patient-links';
import { patient } from './patients';

/**
 * Report photos and scans (INT-02, TAD section 9): the file is in the private `reports` bucket at
 * `file_path`; this row says whose it is, the visit it came with, what it is and who added it.
 * Rows are only ever added (audited); opening files comes with the consultation screens. Staff
 * add reports at the desk; a patient adds them on the health form (INT-05), through its link.
 */
export const patientReport = pgTable(
  'patient_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id, { onDelete: 'cascade' }),
    /** The visit it came with; a report stays with the patient if that appointment goes. */
    appointmentId: uuid('appointment_id').references(() => appointment.id, {
      onDelete: 'set null',
    }),
    /** Within the `reports` bucket: `<patient id>/<report id>.<jpg|png|pdf>`. */
    filePath: text('file_path').notNull().unique(),
    contentType: text('content_type', { enum: reportContentTypes }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** The staff member who added it; or, added by the patient, the link they added it on. */
    uploadedBy: uuid('uploaded_by').references(() => staffUser.id),
    patientLinkId: uuid('patient_link_id').references(() => patientLink.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('patient_report_patient_idx').on(table.patientId, table.createdAt),
    check(
      'patient_report_content_type',
      sql`${table.contentType} in ('image/jpeg', 'image/png', 'application/pdf')`,
    ),
    check('patient_report_size', sql`${table.sizeBytes} > 0`),
    check(
      'patient_report_uploader',
      sql`(${table.uploadedBy} is null) <> (${table.patientLinkId} is null)`,
    ),
  ],
).enableRLS();
