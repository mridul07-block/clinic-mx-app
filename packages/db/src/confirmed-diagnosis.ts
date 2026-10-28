import type { ConfirmedDiagnosisStage } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { confirmedDiagnosis, consultation, diagnosis, kbCondition } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The diagnosis confirmed at review or discharge (AI-05; PRD section 6: the learning label). A
 * consultant confirms the episode's latest signed diagnosis or changes it to another condition of
 * its knowledge base version; `internal.confirmed_diagnosis_guard` checks the ticks and the signed
 * diagnosis, and stamps the stage, who and when. Never changed: the latest is the label.
 */

export interface SignedDiagnosis {
  id: string;
  kbVersionId: string;
  conditionId: string;
  name: string;
}

/** The episode's latest signed diagnosis, as the reader may read it; undefined before one. */
export async function latestSignedDiagnosis(
  db: DbOrTransaction,
  episodeId: string,
): Promise<SignedDiagnosis | undefined> {
  const [row] = await db
    .select({
      id: diagnosis.id,
      kbVersionId: diagnosis.kbVersionId,
      conditionId: diagnosis.conditionId,
      name: kbCondition.name,
    })
    .from(diagnosis)
    .innerJoin(consultation, eq(consultation.id, diagnosis.consultationId))
    .innerJoin(
      kbCondition,
      and(
        eq(kbCondition.kbVersionId, diagnosis.kbVersionId),
        eq(kbCondition.conditionId, diagnosis.conditionId),
      ),
    )
    .where(and(eq(diagnosis.episodeId, episodeId), eq(consultation.status, 'signed')))
    .orderBy(desc(consultation.signedAt), desc(consultation.id))
    .limit(1);
  return row;
}

export interface ConfirmedDiagnosisRecord {
  conditionId: string;
  name: string;
  stage: ConfirmedDiagnosisStage;
  /** The signed diagnosis it confirmed, when it changed it: false. */
  changed: boolean;
  confirmedByName: string;
  confirmedAt: Date;
}

/** The episode's latest confirmed diagnosis, as the reader may read it; undefined before one. */
export async function latestConfirmedDiagnosis(
  db: DbOrTransaction,
  episodeId: string,
): Promise<ConfirmedDiagnosisRecord | undefined> {
  const [row] = await db
    .select({
      conditionId: confirmedDiagnosis.conditionId,
      name: kbCondition.name,
      stage: confirmedDiagnosis.stage,
      changed: sql<boolean>`${confirmedDiagnosis.conditionId} <> ${diagnosis.conditionId}`,
      // Through an internal function: a confirmation is read at any centre, like a signed record.
      confirmedByName: sql<string>`coalesce(internal.record_staff_name(${confirmedDiagnosis.confirmedBy}), '')`,
      confirmedAt: confirmedDiagnosis.confirmedAt,
    })
    .from(confirmedDiagnosis)
    .innerJoin(diagnosis, eq(diagnosis.id, confirmedDiagnosis.sourceDiagnosisId))
    .innerJoin(
      kbCondition,
      and(
        eq(kbCondition.kbVersionId, confirmedDiagnosis.kbVersionId),
        eq(kbCondition.conditionId, confirmedDiagnosis.conditionId),
      ),
    )
    .where(eq(confirmedDiagnosis.episodeId, episodeId))
    .orderBy(desc(confirmedDiagnosis.confirmedAt), desc(confirmedDiagnosis.id))
    .limit(1);
  return row;
}

/** Records the confirmation; the database stamps the stage, who and when. Its stage. */
export async function recordConfirmedDiagnosis(
  tx: DbOrTransaction,
  values: { episodeId: string; source: SignedDiagnosis; conditionId: string; by: string },
): Promise<ConfirmedDiagnosisStage> {
  const [row] = await tx
    .insert(confirmedDiagnosis)
    .values({
      episodeId: values.episodeId,
      sourceDiagnosisId: values.source.id,
      kbVersionId: values.source.kbVersionId,
      conditionId: values.conditionId,
      // Stamped by the database from the episode.
      stage: 'review',
      confirmedBy: values.by,
    })
    .returning({ stage: confirmedDiagnosis.stage });
  if (!row) throw new Error('The diagnosis was not confirmed.');
  return row.stage;
}
