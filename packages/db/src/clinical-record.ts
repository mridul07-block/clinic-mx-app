import type { SignedRows } from '@clinic-mx/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  addendum,
  appointment,
  consultation,
  diagnosis,
  measure,
  planModality,
  planOfCare,
  specialTestResult,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Signing a consultation and its addenda (CLN-09). Run under row level security as the signer:
 * the rules migration lets the record's rows be written only in the signing transaction, checks
 * the Treats patients tick at that moment, and never lets a signed consultation or its rows
 * change.
 */

export interface SignRequest {
  consultationId: string;
  /** The version the signer saw; a newer save makes the signing stale. */
  baseVersion: number;
  by: string;
  episodeId: string;
  appointmentId: string;
  kbVersionId: string;
  rows: SignedRows;
}

/**
 * Signs the consultation at `baseVersion`, writes its record (measures, special test results,
 * the diagnosis, the plan of care as version 1 and its modalities) and completes its visit, in
 * the caller's transaction. Stale when the consultation is no longer a draft at that version.
 */
export async function signConsultation(
  tx: DbOrTransaction,
  request: SignRequest,
): Promise<'signed' | 'stale'> {
  const [signed] = await tx
    .update(consultation)
    .set({
      status: 'signed',
      signedBy: request.by,
      // The transaction's own time: the record's rows may be written only while it is now.
      signedAt: sql`now()`,
      version: sql`${consultation.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(consultation.id, request.consultationId),
        eq(consultation.version, request.baseVersion),
        eq(consultation.status, 'draft'),
      ),
    )
    .returning({ id: consultation.id });
  if (!signed) return 'stale';

  const { rows } = request;
  const owned = {
    episodeId: request.episodeId,
    consultationId: request.consultationId,
  };
  if (rows.measures.length > 0) {
    await tx.insert(measure).values(
      rows.measures.map((row) => ({
        ...owned,
        kbVersionId: request.kbVersionId,
        measureKey: row.key,
        limb: row.limb,
        side: row.side,
        value: row.value,
        unit: row.unit,
        createdBy: request.by,
      })),
    );
  }
  if (rows.tests.length > 0) {
    await tx.insert(specialTestResult).values(
      rows.tests.map((row) => ({
        ...owned,
        kbVersionId: request.kbVersionId,
        testKey: row.key,
        result: row.result,
        interpretation: row.interpretation,
      })),
    );
  }
  await tx.insert(diagnosis).values({
    ...owned,
    kbVersionId: request.kbVersionId,
    conditionId: rows.diagnosis.conditionId,
    movementDx: rows.diagnosis.movement,
    irritability: rows.diagnosis.irritability,
    stage: rows.diagnosis.stage,
    categoryCode: rows.diagnosis.categoryCode,
    provisional: rows.diagnosis.provisional,
  });
  const [plan] = await tx
    .insert(planOfCare)
    .values({
      ...owned,
      version: 1,
      goals: rows.plan.goals,
      interventions: rows.plan.interventions,
      sessionsPerWeek: rows.plan.sessionsPerWeek,
      weeks: rows.plan.weeks,
      homeProgramme: rows.plan.homeProgramme,
      reviewDate: rows.plan.reviewDate,
      questionnaires: rows.plan.questionnaires,
      treatingPhysioId: rows.plan.treatingPhysioId,
      investigationsAdvised: rows.plan.investigations,
      referralAdvised: rows.plan.referral,
      createdBy: request.by,
    })
    .returning({ id: planOfCare.id });
  if (!plan) throw new Error('The plan of care was not written.');
  if (rows.plan.modalities.length > 0) {
    await tx.insert(planModality).values(
      rows.plan.modalities.map((row) => ({
        planOfCareId: plan.id,
        modalityKey: row.key,
        reason: row.reason,
      })),
    );
  }
  await tx
    .update(appointment)
    .set({ status: 'completed', completedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(appointment.id, request.appointmentId), eq(appointment.status, 'in_progress')));
  return 'signed';
}

export interface AddendumEntry {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
}

/** A signed consultation's addenda, oldest first, with who wrote them. */
export function consultationAddenda(
  db: DbOrTransaction,
  consultationId: string,
): Promise<AddendumEntry[]> {
  return db
    .select({
      id: addendum.id,
      text: addendum.text,
      authorId: addendum.authorId,
      authorName: sql<string>`coalesce(internal.record_staff_name(${addendum.authorId}), '')`,
      createdAt: addendum.createdAt,
    })
    .from(addendum)
    .where(eq(addendum.consultationId, consultationId))
    .orderBy(asc(addendum.createdAt), asc(addendum.id));
}

/** Adds an addendum to a signed consultation; row level security decides who may. */
export async function addAddendum(
  tx: DbOrTransaction,
  entry: { consultationId: string; episodeId: string; text: string; authorId: string },
): Promise<{ id: string }> {
  const [row] = await tx.insert(addendum).values(entry).returning({ id: addendum.id });
  if (!row) throw new Error('The addendum was not written.');
  return row;
}

/** Whether a staff member is active with the Treats patients tick now, read from the record. */
export async function staffTreatsNow(db: DbOrTransaction, staffId: string): Promise<boolean> {
  const [row] = await db
    .select({ treats: staffUser.treatsPatients, active: staffUser.active })
    .from(staffUser)
    .where(eq(staffUser.id, staffId));
  return Boolean(row?.treats && row.active);
}
