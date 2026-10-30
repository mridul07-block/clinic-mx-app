import { asc, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { consentRecord, guardian, patient } from './schema';
import type { DbOrTransaction } from './versioned';

/** A consent decision as read back (INT-06). */
export interface ConsentDecisionRow {
  statementKey: string;
  accepted: boolean;
  createdAt: Date;
}

const decision = {
  statementKey: consentRecord.statementKey,
  accepted: consentRecord.accepted,
  createdAt: consentRecord.createdAt,
};

/** Adds consent records; they are never changed. Row level security decides who may. */
export async function insertConsentRecords(
  tx: DbOrTransaction,
  rows: (typeof consentRecord.$inferInsert)[],
): Promise<void> {
  if (rows.length > 0) await tx.insert(consentRecord).values(rows);
}

/** A guardian as a patient page shows them (INT-07): no phone. */
export interface OwnGuardian {
  id: string;
  name: string;
  relationship: (typeof guardian.$inferSelect)['relationship'];
}

/** The link's own patient, by name and date of birth, inside `withPatientAccess` (BIL-03). */
export async function ownPatient(
  db: DbOrTransaction,
): Promise<{ id: string; name: string; dateOfBirth: string | null } | undefined> {
  const [row] = await db
    .select({ id: patient.id, name: patient.name, dateOfBirth: patient.dateOfBirth })
    .from(patient);
  return row;
}

/** The patient's guardians on file who are not removed, inside `withPatientAccess`. */
export function ownGuardians(db: DbOrTransaction): Promise<OwnGuardian[]> {
  return db
    .select({ id: guardian.id, name: guardian.name, relationship: guardian.relationship })
    .from(guardian)
    .orderBy(asc(guardian.name));
}

/** The page's own Part A decisions, inside `withPatientAccess` (its link's rows only). */
export function ownConsentDecisions(db: DbOrTransaction): Promise<ConsentDecisionRow[]> {
  return db
    .select(decision)
    .from(consentRecord)
    .where(eq(consentRecord.stage, 'A'))
    .orderBy(asc(consentRecord.createdAt));
}

/**
 * True when any Part A statement's latest decision for the appointment is a decline: reception
 * speaks to the patient (Blueprint Module 3). Under the reader's row level security.
 */
export function partAConsentDeclined(appointmentId: AnyPgColumn | string): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from consent_record c
    where c.appointment_id = ${appointmentId} and c.stage = 'A' and not c.accepted
      and not exists (
        select 1 from consent_record n
        where n.appointment_id = c.appointment_id and n.statement_key = c.statement_key
          and n.created_at > c.created_at
      )
  )`;
}
