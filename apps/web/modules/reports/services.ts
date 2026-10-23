import 'server-only';
import {
  patientReports,
  reportFileOf,
  type PatientReportEntry,
  type StaffMember,
} from '@clinic-mx/db';
import { can, type ReportContentType } from '@clinic-mx/schemas';
import { asStaff } from '../access/staff-db';
import { reportStore, type ReportStore } from '../front-desk/report-store';

/**
 * Opening report photos and scans (ALT-08): clinicians only, meaning `clinical.read` (the Super
 * Admin, and staff with the Treats patients tick), at any centre (user decision, 23 October
 * 2026). Row level security checks the same; the file comes from the private bucket through our
 * server only (rule 9). Anyone else learns nothing, not even that the report exists.
 */

/** A patient's reports for the patient record; none for those who cannot open them. */
export async function reportsOfPatient(
  actor: StaffMember,
  patientId: string,
): Promise<PatientReportEntry[]> {
  if (!can(actor, 'clinical.read')) return [];
  return asStaff(actor, (tx) => patientReports(tx, patientId));
}

export interface ReportFile {
  bytes: Uint8Array;
  contentType: ReportContentType;
}

/** The report's file for a clinician; undefined when it is not there or not theirs to open. */
export async function reportFile(
  actor: StaffMember,
  reportId: string,
  store: ReportStore = reportStore(),
): Promise<ReportFile | undefined> {
  if (!can(actor, 'clinical.read')) return undefined;
  const found = await asStaff(actor, (tx) => reportFileOf(tx, reportId));
  if (!found) return undefined;
  return { bytes: await store.get(found.filePath), contentType: found.contentType };
}
