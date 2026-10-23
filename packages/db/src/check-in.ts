import type { AppointmentStatus, ReportContentType } from '@clinic-mx/schemas';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  appointment,
  appointmentType,
  patient,
  patientLink,
  patientReport,
  staffUser,
} from './schema';
import { partAConsentDeclined } from './consent';
import type { DbOrTransaction } from './versioned';

/** What the check in drawer shows about an appointment (INT-02). */
export interface CheckInView {
  id: string;
  number: string;
  centreId: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  episodeId: string | null;
  typeName: string;
  physioName: string;
  arrivedAt: Date | null;
  checkedInByName: string | null;
  patientId: string;
  patientName: string;
  opNumber: string;
  dateOfBirth: string | null;
  /** The mobile's last four digits only: enough to check, without the whole number on screen. */
  phoneEnding: string;
  /** A Part A consent declined (INT-06). */
  consentDeclined: boolean;
}

const physio = alias(staffUser, 'check_in_physio');
const checker = alias(staffUser, 'check_in_by');

/** One appointment for the check in drawer, under the reader's row level security. */
export async function checkInView(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<CheckInView | undefined> {
  const [row] = await db
    .select({
      id: appointment.id,
      number: appointment.number,
      centreId: appointment.centreId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      episodeId: appointment.episodeId,
      typeName: appointmentType.name,
      physioName: physio.name,
      arrivedAt: appointment.arrivedAt,
      checkedInByName: checker.name,
      patientId: appointment.patientId,
      patientName: patient.name,
      opNumber: patient.opNumber,
      dateOfBirth: patient.dateOfBirth,
      phone: patient.phone,
      consentDeclined: partAConsentDeclined(appointment.id),
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(physio, eq(physio.id, appointment.physioId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .leftJoin(checker, eq(checker.id, appointment.checkedInBy))
    .where(eq(appointment.id, appointmentId));
  if (!row) return undefined;
  const { phone, ...view } = row;
  return { ...view, phoneEnding: phone.slice(-4) };
}

/** An appointment's latest health form link, as check in staff may read it (INT-02). */
export interface HealthFormLink {
  id: string;
  expiresAt: Date;
  revokedAt: Date | null;
  completedAt: Date | null;
}

export async function healthFormLink(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<HealthFormLink | undefined> {
  const [row] = await db
    .select({
      id: patientLink.id,
      expiresAt: patientLink.expiresAt,
      revokedAt: patientLink.revokedAt,
      completedAt: patientLink.completedAt,
    })
    .from(patientLink)
    .where(
      and(eq(patientLink.appointmentId, appointmentId), eq(patientLink.purpose, 'health_form')),
    )
    .orderBy(desc(patientLink.createdAt))
    .limit(1);
  return row;
}

/** A report photo or scan as the drawer lists it (INT-02). */
export interface PatientReportEntry {
  id: string;
  appointmentId: string | null;
  contentType: ReportContentType;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: Date;
}

/** A patient's reports, newest first. */
export function patientReports(
  db: DbOrTransaction,
  patientId: string,
): Promise<PatientReportEntry[]> {
  return db
    .select({
      id: patientReport.id,
      appointmentId: patientReport.appointmentId,
      contentType: patientReport.contentType,
      sizeBytes: patientReport.sizeBytes,
      uploadedByName: staffUser.name,
      createdAt: patientReport.createdAt,
    })
    .from(patientReport)
    .innerJoin(staffUser, eq(staffUser.id, patientReport.uploadedBy))
    .where(eq(patientReport.patientId, patientId))
    .orderBy(desc(patientReport.createdAt));
}

/** Records a report already stored at `filePath` in the `reports` bucket. */
export async function insertPatientReport(
  tx: DbOrTransaction,
  report: {
    id: string;
    patientId: string;
    appointmentId: string;
    filePath: string;
    contentType: ReportContentType;
    sizeBytes: number;
    uploadedBy: string;
  },
): Promise<{ id: string }> {
  const [row] = await tx.insert(patientReport).values(report).returning({ id: patientReport.id });
  if (!row) throw new Error('The report was not recorded.');
  return row;
}
