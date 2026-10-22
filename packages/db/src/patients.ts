import type {
  GuardianDetails,
  GuardianRelationship,
  NewPatient,
  PatientDetails,
  PatientSearch,
  PatientSex,
} from '@clinic-mx/schemas';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { centre, guardian, patient } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Patients (SCH-01): keyed by person, so several share one mobile. Run under row level security:
 * every signed in staff member reads every patient; the Super Admin, Centre Managers and the
 * Front Desk add (at a centre they see) and edit them. The database sets the OP number and keeps
 * it and the registering centre fixed; every change is audited by the trigger.
 */

export interface PatientEntry {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  dateOfBirth: string | null;
  sex: PatientSex | null;
  occupation: string | null;
  opNumber: string;
  registeredCentreId: string;
  /** Null when the reader does not see that centre; the OP number still carries its code. */
  registeredCentreName: string | null;
}

/** A patient as a list shows them. */
export interface PatientMatch {
  id: string;
  name: string;
  phone: string;
  opNumber: string;
}

const matchColumns = {
  id: patient.id,
  name: patient.name,
  phone: patient.phone,
  opNumber: patient.opNumber,
};

/** The most a search lists; staff narrow it by typing more. */
export const PATIENT_SEARCH_LIMIT = 20;

/** One patient with their registering centre's name, or undefined when not found. */
export async function patientRecord(
  db: DbOrTransaction,
  patientId: string,
): Promise<PatientEntry | undefined> {
  const [row] = await db
    .select({
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      email: patient.email,
      dateOfBirth: patient.dateOfBirth,
      sex: patient.sex,
      occupation: patient.occupation,
      opNumber: patient.opNumber,
      registeredCentreId: patient.registeredCentreId,
      registeredCentreName: centre.name,
    })
    .from(patient)
    .leftJoin(centre, eq(centre.id, patient.registeredCentreId))
    .where(eq(patient.id, patientId));
  return row;
}

/** Everyone on a mobile, other than `exceptId`, by name. */
export function patientsOnPhone(
  db: DbOrTransaction,
  phone: string,
  exceptId?: string,
): Promise<PatientMatch[]> {
  return db
    .select(matchColumns)
    .from(patient)
    .where(and(eq(patient.phone, phone), exceptId ? ne(patient.id, exceptId) : undefined))
    .orderBy(asc(patient.name), asc(patient.opNumber));
}

/** `%` and `_` typed into a search are letters, not wildcards. */
const literal = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

/** Patients whose mobile contains the digits, or whose name contains the text (any case). */
export function searchPatients(
  db: DbOrTransaction,
  search: PatientSearch,
): Promise<PatientMatch[]> {
  const where =
    search.kind === 'phone'
      ? sql`${patient.phone} like ${`%${search.digits}%`}`
      : sql`lower(${patient.name}) like ${`%${literal(search.text.toLowerCase())}%`}`;
  return db
    .select(matchColumns)
    .from(patient)
    .where(where)
    .orderBy(asc(patient.name), asc(patient.opNumber))
    .limit(PATIENT_SEARCH_LIMIT);
}

const detailColumns = (details: PatientDetails) => ({
  name: details.name,
  phone: details.phone,
  email: details.email ?? null,
  dateOfBirth: details.dateOfBirth ?? null,
  sex: details.sex ?? null,
  occupation: details.occupation ?? null,
});

/** Records a patient at a centre; returns the id and the OP number the database issued. */
export async function insertPatient(
  db: DbOrTransaction,
  details: Omit<NewPatient, 'confirmNewPerson'>,
): Promise<{ id: string; opNumber: string }> {
  const [row] = await db
    .insert(patient)
    // The trigger replaces this placeholder with the centre's next OP number.
    .values({
      ...detailColumns(details),
      registeredCentreId: details.registeredCentreId,
      opNumber: '',
    })
    .returning({ id: patient.id, opNumber: patient.opNumber });
  if (!row) throw new Error('The patient was not recorded.');
  return row;
}

/** Changes a patient's details; false when they were not found. */
export async function updatePatient(
  db: DbOrTransaction,
  patientId: string,
  details: PatientDetails,
): Promise<boolean> {
  const updated = await db
    .update(patient)
    .set({ ...detailColumns(details), updatedAt: sql`now()` })
    .where(eq(patient.id, patientId))
    .returning({ id: patient.id });
  return updated.length > 0;
}

/** A guardian as the patient page shows them (SCH-02). */
export interface GuardianEntry {
  id: string;
  patientId: string;
  name: string;
  relationship: GuardianRelationship;
  phone: string;
  removedAt: Date | null;
}

const guardianColumns = {
  id: guardian.id,
  patientId: guardian.patientId,
  name: guardian.name,
  relationship: guardian.relationship,
  phone: guardian.phone,
  removedAt: guardian.removedAt,
};

/** A patient's current guardians (removed ones left out), by name. */
export function guardiansOf(db: DbOrTransaction, patientId: string): Promise<GuardianEntry[]> {
  return db
    .select(guardianColumns)
    .from(guardian)
    .where(and(eq(guardian.patientId, patientId), isNull(guardian.removedAt)))
    .orderBy(asc(guardian.name));
}

/** One guardian, removed or not, or undefined when not found. */
export async function guardianRecord(
  db: DbOrTransaction,
  guardianId: string,
): Promise<GuardianEntry | undefined> {
  const [row] = await db.select(guardianColumns).from(guardian).where(eq(guardian.id, guardianId));
  return row;
}

/** Records a guardian for a patient; returns its id. */
export async function insertGuardian(
  db: DbOrTransaction,
  patientId: string,
  details: GuardianDetails,
): Promise<string> {
  const [row] = await db
    .insert(guardian)
    .values({ patientId, ...details })
    .returning({ id: guardian.id });
  if (!row) throw new Error('The guardian was not recorded.');
  return row.id;
}

/** Changes a current guardian's details; false when not found or removed. */
export async function updateGuardian(
  db: DbOrTransaction,
  guardianId: string,
  details: GuardianDetails,
): Promise<boolean> {
  const updated = await db
    .update(guardian)
    .set({ ...details, updatedAt: sql`now()` })
    .where(and(eq(guardian.id, guardianId), isNull(guardian.removedAt)))
    .returning({ id: guardian.id });
  return updated.length > 0;
}

/** Removes a guardian (kept for the consents they signed); false when not found or removed. */
export async function removeGuardian(db: DbOrTransaction, guardianId: string): Promise<boolean> {
  const removed = await db
    .update(guardian)
    .set({ removedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(guardian.id, guardianId), isNull(guardian.removedAt)))
    .returning({ id: guardian.id });
  return removed.length > 0;
}
