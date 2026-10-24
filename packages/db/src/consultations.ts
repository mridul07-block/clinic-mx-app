import type {
  ConsultationSections,
  ConsultationStatus,
  HealthFormAnswers,
} from '@clinic-mx/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import { latestKnowledgeVersion } from './knowledge';
import {
  appointment,
  appointmentType,
  centre,
  consultation,
  patient,
  staffUser,
  staffUserCentre,
} from './schema';
import { updateVersioned, type DbOrTransaction, type VersionedResult } from './versioned';

/** A consultation as its screen shows it (CLN-02). */
export interface ConsultationEntry {
  id: string;
  appointmentId: string;
  episodeId: string;
  physioId: string;
  /** The knowledge base version the consultation keeps (rule 4). */
  kbVersionId: string;
  sections: Record<string, unknown>;
  status: ConsultationStatus;
  version: number;
  /** Who signed it and when (CLN-09); null while a draft. */
  signedBy: string | null;
  signedByName: string | null;
  signedAt: Date | null;
  patientId: string;
  patientName: string;
  opNumber: string;
  appointmentNumber: string;
  startsAt: Date;
  centreId: string;
  centreName: string;
  typeName: string;
}

export class NoKnowledgeVersionError extends Error {
  constructor() {
    super('The knowledge base has no version yet');
    this.name = 'NoKnowledgeVersionError';
  }
}

/**
 * Opens the consultation of a visit, or finds the one already open (one per appointment), with
 * today's knowledge base version (rule 4). The service checks it is the consultant's own visit
 * on its episode; row level security and the rules migration check it too.
 */
export async function openConsultation(
  tx: DbOrTransaction,
  open: { appointmentId: string; episodeId: string; physioId: string },
): Promise<string> {
  const version = await latestKnowledgeVersion(tx);
  if (!version) throw new NoKnowledgeVersionError();
  const [created] = await tx
    .insert(consultation)
    .values({ ...open, kbVersionId: version.id })
    .onConflictDoNothing({ target: consultation.appointmentId })
    .returning({ id: consultation.id });
  if (created) return created.id;
  const [existing] = await tx
    .select({ id: consultation.id })
    .from(consultation)
    .where(eq(consultation.appointmentId, open.appointmentId));
  if (!existing) throw new Error('The consultation was not recorded.');
  return existing.id;
}

/** One consultation with its patient and visit, or undefined when not found (or not readable). */
export async function consultationRecord(
  db: DbOrTransaction,
  consultationId: string,
): Promise<ConsultationEntry | undefined> {
  const [row] = await db
    .select({
      id: consultation.id,
      appointmentId: consultation.appointmentId,
      episodeId: consultation.episodeId,
      physioId: consultation.physioId,
      kbVersionId: consultation.kbVersionId,
      sections: consultation.sections,
      status: consultation.status,
      version: consultation.version,
      signedBy: consultation.signedBy,
      signedByName: sql<
        string | null
      >`(select s.name from staff_user s where s.id = ${consultation.signedBy})`,
      signedAt: consultation.signedAt,
      patientId: appointment.patientId,
      patientName: patient.name,
      opNumber: patient.opNumber,
      appointmentNumber: appointment.number,
      startsAt: appointment.startsAt,
      centreId: centre.id,
      centreName: centre.name,
      typeName: appointmentType.name,
    })
    .from(consultation)
    .innerJoin(appointment, eq(appointment.id, consultation.appointmentId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(eq(consultation.id, consultationId));
  return row;
}

/** Saves the sections only at `baseVersion` (FND-08); a conflict answers with what is saved. */
export function saveConsultationSections(
  tx: DbOrTransaction,
  consultationId: string,
  baseVersion: number,
  sections: ConsultationSections,
): Promise<VersionedResult<typeof consultation.$inferSelect>> {
  return updateVersioned(tx, consultation, consultationId, baseVersion, {
    sections,
    updatedAt: new Date(),
  });
}

/**
 * The submitted health form of a visit (CLN-03): what the patient told us, for Subjective. Only
 * the visit's own treating physio gets it (`internal.consultant_health_form`); undefined
 * otherwise, or when none was submitted.
 */
export async function consultationIntake(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<{ formVersion: string; answers: HealthFormAnswers } | undefined> {
  const [row] = await db.execute<{ form_version: string; answers: HealthFormAnswers }>(
    sql`select form_version, answers from internal.consultant_health_form(${appointmentId})`,
  );
  return row && { formVersion: row.form_version, answers: row.answers };
}

/**
 * Who can be a plan's treating physio at a centre (CLN-07): active staff assigned there with the
 * Treats patients tick, never Velyx support, by name. Read under row level security.
 */
export function treatingPhysios(
  db: DbOrTransaction,
  centreId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: staffUser.id, name: staffUser.name })
    .from(staffUser)
    .innerJoin(staffUserCentre, eq(staffUserCentre.staffUserId, staffUser.id))
    .where(
      and(
        eq(staffUserCentre.centreId, centreId),
        eq(staffUser.active, true),
        eq(staffUser.treatsPatients, true),
        eq(staffUser.velyxSupport, false),
      ),
    )
    .orderBy(asc(staffUser.name));
}
