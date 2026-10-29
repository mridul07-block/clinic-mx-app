import {
  questionnaireDefinitionSchema,
  type QuestionnaireDefinition,
  type QuestionnaireRawAnswers,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { kbQuestionnaire, patientLink, questionnaireResult } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Patient filled questionnaires (OUT-02; docs/runbooks/questionnaires.md): the questionnaires a
 * link still has to fill, the patient's result for each, the desk's QR, and the results
 * clinicians read.
 */

/** A questionnaire the page's own link still has to fill, with whom it is for. */
export interface DueQuestionnaire {
  patientId: string;
  episodeId: string;
  centreId: string;
  key: string;
  name: string;
  kbVersionId: string;
  definition: QuestionnaireDefinition;
}

/** The page's link's questionnaires still to fill, in the plan's order (as the patient). */
export async function questionnairesDue(db: DbOrTransaction): Promise<DueQuestionnaire[]> {
  const rows = await db.execute<{
    patient_id: string;
    episode_id: string;
    centre_id: string;
    key: string;
    name: string;
    kb_version_id: string;
    definition: unknown;
  }>(sql`select * from internal.questionnaires_due()`);
  return rows.flatMap((row) => {
    // The import validated it; one that no longer reads is not offered.
    const definition = questionnaireDefinitionSchema.safeParse(row.definition);
    return definition.success
      ? [
          {
            patientId: row.patient_id,
            episodeId: row.episode_id,
            centreId: row.centre_id,
            key: row.key,
            name: row.name,
            kbVersionId: row.kb_version_id,
            definition: definition.data,
          },
        ]
      : [];
  });
}

/** Whether the page's link has every questionnaire filled (as the patient). */
export async function questionnairesDone(db: DbOrTransaction, linkId: string): Promise<boolean> {
  const [row] = await db.execute<{ done: boolean }>(
    sql`select internal.questionnaires_done(${linkId}::uuid) as done`,
  );
  return row?.done === true;
}

/** How many questionnaires the page's link has filled (as the patient). */
export async function questionnairesAnswered(db: DbOrTransaction): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`select internal.questionnaires_answered() as n`,
  );
  return row?.n ?? 0;
}

/** Keeps the patient's filled questionnaire on their link, as scored by our server. */
export async function insertQuestionnaireResult(
  db: DbOrTransaction,
  values: {
    linkId: string;
    due: DueQuestionnaire;
    rawAnswers: QuestionnaireRawAnswers;
    score: number | null;
    answered: number;
    missing: number;
  },
): Promise<void> {
  await db.insert(questionnaireResult).values({
    patientLinkId: values.linkId,
    patientId: values.due.patientId,
    episodeId: values.due.episodeId,
    centreId: values.due.centreId,
    kbVersionId: values.due.kbVersionId,
    instrumentKey: values.due.key,
    instrumentVersion: values.due.definition.version,
    rawAnswers: values.rawAnswers,
    score: values.score,
    answered: values.answered,
    missing: values.missing,
  });
}

/**
 * The desk's view of an open episode's questionnaires (as those who check in at its centre):
 * whom for, how many the plan names, and how many can be filled now; undefined otherwise.
 */
export async function questionnaireTarget(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ patientId: string; assigned: number; fillable: number } | undefined> {
  const [row] = await db.execute<{ patient_id: string; assigned: number; fillable: number }>(
    sql`select patient_id, assigned, fillable from internal.questionnaire_target(${episodeId}::uuid)`,
  );
  return row
    ? { patientId: row.patient_id, assigned: row.assigned, fillable: row.fillable }
    : undefined;
}

/** The episode's working questionnaire link (not stopped, used or ended), the newest. */
export async function liveQuestionnaireLink(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ id: string; expiresAt: Date } | undefined> {
  const [row] = await db
    .select({ id: patientLink.id, expiresAt: patientLink.expiresAt })
    .from(patientLink)
    .where(
      and(
        eq(patientLink.episodeId, episodeId),
        eq(patientLink.purpose, 'questionnaire'),
        isNull(patientLink.revokedAt),
        isNull(patientLink.completedAt),
        gt(patientLink.expiresAt, sql`now()`),
        // Not one with every questionnaire filled that the page has not closed yet.
        sql`not internal.questionnaires_done(${patientLink.id})`,
      ),
    )
    .orderBy(desc(patientLink.createdAt))
    .limit(1);
  return row;
}

/** A filled questionnaire as clinicians read it. */
export interface QuestionnaireResultEntry {
  instrumentKey: string;
  instrumentVersion: string;
  kbVersionId: string;
  score: number | null;
  answered: number;
  missing: number;
  submittedAt: Date;
}

/** An episode's filled questionnaires, oldest first (under the reader's own access). */
export function questionnaireResults(
  db: DbOrTransaction,
  episodeId: string,
): Promise<QuestionnaireResultEntry[]> {
  return db
    .select({
      instrumentKey: questionnaireResult.instrumentKey,
      instrumentVersion: questionnaireResult.instrumentVersion,
      kbVersionId: questionnaireResult.kbVersionId,
      score: questionnaireResult.score,
      answered: questionnaireResult.answered,
      missing: questionnaireResult.missing,
      submittedAt: questionnaireResult.submittedAt,
    })
    .from(questionnaireResult)
    .where(eq(questionnaireResult.episodeId, episodeId))
    .orderBy(asc(questionnaireResult.submittedAt));
}

/**
 * The instruments results were filled on, each in its knowledge base version: name and definition
 * (under the reader's own access to the knowledge base).
 */
export async function filledInstruments(
  db: DbOrTransaction,
  filled: readonly { kbVersionId: string; key: string }[],
): Promise<
  { kbVersionId: string; key: string; name: string; definition: QuestionnaireDefinition }[]
> {
  if (filled.length === 0) return [];
  const rows = await db
    .select({
      kbVersionId: kbQuestionnaire.kbVersionId,
      key: kbQuestionnaire.key,
      name: kbQuestionnaire.name,
      definition: kbQuestionnaire.definition,
    })
    .from(kbQuestionnaire)
    .where(
      or(
        ...filled.map((each) =>
          and(eq(kbQuestionnaire.kbVersionId, each.kbVersionId), eq(kbQuestionnaire.key, each.key)),
        ),
      ),
    )
    .orderBy(asc(kbQuestionnaire.name));
  return rows.flatMap((row) => {
    const definition = questionnaireDefinitionSchema.safeParse(row.definition);
    return definition.success ? [{ ...row, definition: definition.data }] : [];
  });
}
