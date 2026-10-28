import type {
  AssessmentCatalog,
  AssessmentCondition,
  KnowledgeMeasure,
  KnowledgeSpecialTest,
  PlanCatalog,
} from '@clinic-mx/schemas';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import {
  kbCondition,
  kbConditionListing,
  kbDiagnosisCategory,
  kbMeasure,
  kbModality,
  kbQuestionnaire,
  kbRedFlagPresentation,
  kbRedFlagRule,
  kbSpecialTest,
  kbVersion,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Reading the knowledge base (SET-05). Run under row level security: the Super Admin, Centre
 * Managers and physiotherapists read it; nobody signed in writes it. Condition search (CLN-06),
 * the diagnosis shortlist (AI-02) and the version viewer (SET-06) build on these.
 */

export type KnowledgeVersion = Pick<
  typeof kbVersion.$inferSelect,
  'id' | 'number' | 'status' | 'approvedAt' | 'createdAt'
>;

/**
 * The live version's condition (SET-06): approved, the newest of them; before the first approval
 * any version, so the import works before anyone has approved one. A draft never goes live once a
 * version is approved.
 */
export const liveVersionCondition = sql`(${kbVersion.status} = 'approved' or not exists (
  select 1 from public.kb_version approved where approved.status = 'approved'))`;

/**
 * The live version new clinical records take (SET-06): the newest approved; before the first
 * approval, the newest import. Undefined before the first import.
 */
export async function latestKnowledgeVersion(
  db: DbOrTransaction,
): Promise<KnowledgeVersion | undefined> {
  const [version] = await db
    .select({
      id: kbVersion.id,
      number: kbVersion.number,
      status: kbVersion.status,
      approvedAt: kbVersion.approvedAt,
      createdAt: kbVersion.createdAt,
    })
    .from(kbVersion)
    .where(liveVersionCondition)
    .orderBy(desc(kbVersion.number))
    .limit(1);
  return version;
}

/** A version as the viewer lists it (SET-06). */
export interface KnowledgeVersionEntry {
  id: string;
  number: number;
  status: 'draft' | 'approved';
  /** The workbooks and files it was imported from, with their SHA-256. */
  source: (typeof kbVersion.$inferSelect)['source'];
  createdBy: string;
  createdAt: Date;
  approvedAt: Date | null;
  approvedByName: string | null;
  notes: string | null;
}

const versionColumns = {
  id: kbVersion.id,
  number: kbVersion.number,
  status: kbVersion.status,
  source: kbVersion.source,
  createdBy: kbVersion.createdBy,
  createdAt: kbVersion.createdAt,
  approvedAt: kbVersion.approvedAt,
  approvedByName: staffUser.name,
  notes: kbVersion.notes,
};

/** Every version, newest first, with who approved it. */
export async function knowledgeVersions(db: DbOrTransaction): Promise<KnowledgeVersionEntry[]> {
  const rows = await db
    .select(versionColumns)
    .from(kbVersion)
    .leftJoin(staffUser, eq(staffUser.id, kbVersion.approvedBy))
    .orderBy(desc(kbVersion.number));
  return rows;
}

/** One version with its import report; undefined when not found. */
export async function knowledgeVersionDetail(
  db: DbOrTransaction,
  versionId: string,
): Promise<(KnowledgeVersionEntry & { report: Record<string, unknown> }) | undefined> {
  const [row] = await db
    .select({ ...versionColumns, report: kbVersion.report })
    .from(kbVersion)
    .leftJoin(staffUser, eq(staffUser.id, kbVersion.approvedBy))
    .where(eq(kbVersion.id, versionId));
  return row;
}

/** What a version holds still awaiting clinical sign off: red flag rules and modality links. */
export async function knowledgeVersionSignOff(
  db: DbOrTransaction,
  versionId: string,
): Promise<{ rules: number; modalities: number }> {
  const [rules] = await db
    .select({ n: count() })
    .from(kbRedFlagRule)
    .where(and(eq(kbRedFlagRule.kbVersionId, versionId), eq(kbRedFlagRule.signedOff, false)));
  const [modalities] = await db
    .select({ n: count() })
    .from(kbModality)
    .where(and(eq(kbModality.kbVersionId, versionId), eq(kbModality.signedOff, false)));
  return { rules: rules?.n ?? 0, modalities: modalities?.n ?? 0 };
}

/**
 * How many consultations and session notes stored a version, drafts included, whatever the
 * reader's own access (`internal.kb_version_usage`, counts only): for the Super Admin only.
 */
export async function knowledgeVersionUsage(
  db: DbOrTransaction,
  versionId: string,
): Promise<{ consultations: number; sessions: number }> {
  const [row] = await db.execute<{ consultations: number; sessions: number }>(
    sql`select consultations, sessions from internal.kb_version_usage(${versionId}::uuid)`,
  );
  return { consultations: row?.consultations ?? 0, sessions: row?.sessions ?? 0 };
}

/** A version the Super Admin cannot approve: already approved, or older than the live one. */
export class KnowledgeVersionNotApprovableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeVersionNotApprovableError';
  }
}

/**
 * The Super Admin approves a draft (SET-06) through `internal.approve_kb_version`, which checks
 * who, the draft and that it is newer than the live version, and names the approver itself.
 * Returns the version's number.
 */
export async function approveKnowledgeVersion(
  tx: DbOrTransaction,
  values: { versionId: string; notes?: string },
): Promise<number> {
  try {
    const [row] = await tx.execute<{ number: number }>(
      sql`select internal.approve_kb_version(${values.versionId}::uuid, ${values.notes ?? null}) as number`,
    );
    return row?.number ?? 0;
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code === '23514' || cause?.code === 'P0002') {
      throw new KnowledgeVersionNotApprovableError(cause.message ?? 'That version was not found.');
    }
    throw error;
  }
}

export type KnowledgeCondition = typeof kbCondition.$inferSelect;
export type KnowledgeListing = typeof kbConditionListing.$inferSelect;

/** A version's conditions, by ID. */
export function knowledgeConditions(
  db: DbOrTransaction,
  versionId: string,
): Promise<KnowledgeCondition[]> {
  return db
    .select()
    .from(kbCondition)
    .where(eq(kbCondition.kbVersionId, versionId))
    .orderBy(asc(kbCondition.conditionId));
}

/** A version's listings (one per workbook row), by condition ID, then workbook and row. */
export function knowledgeListings(
  db: DbOrTransaction,
  versionId: string,
): Promise<KnowledgeListing[]> {
  return db
    .select()
    .from(kbConditionListing)
    .where(eq(kbConditionListing.kbVersionId, versionId))
    .orderBy(
      asc(kbConditionListing.conditionId),
      asc(kbConditionListing.region),
      asc(kbConditionListing.rowNumber),
    );
}

export type KnowledgeRedFlagRule = typeof kbRedFlagRule.$inferSelect;
export type KnowledgeRedFlagPresentation = typeof kbRedFlagPresentation.$inferSelect;

/**
 * A version's red flag rules (SET-10), by key. The health form submit (INT-10) runs them with
 * `evaluateRedFlags` from `@clinic-mx/schemas`.
 */
export function redFlagRules(
  db: DbOrTransaction,
  versionId: string,
): Promise<KnowledgeRedFlagRule[]> {
  return db
    .select()
    .from(kbRedFlagRule)
    .where(eq(kbRedFlagRule.kbVersionId, versionId))
    .orderBy(asc(kbRedFlagRule.ruleKey));
}

/** A version's red flag presentations and screening notes, by workbook and row. */
export function redFlagPresentations(
  db: DbOrTransaction,
  versionId: string,
): Promise<KnowledgeRedFlagPresentation[]> {
  return db
    .select()
    .from(kbRedFlagPresentation)
    .where(eq(kbRedFlagPresentation.kbVersionId, versionId))
    .orderBy(asc(kbRedFlagPresentation.region), asc(kbRedFlagPresentation.rowNumber));
}

/**
 * The Objective's knowledge in a version (CLN-05): every workbook's measures and special tests, in
 * workbook row order, for the consultation that stores that version. Read under row level
 * security: those who view the knowledge base.
 */
export async function knowledgeObjective(
  db: DbOrTransaction,
  versionId: string,
): Promise<{ measures: KnowledgeMeasure[]; specialTests: KnowledgeSpecialTest[] }> {
  const measures = await db
    .select({
      key: kbMeasure.key,
      region: kbMeasure.region,
      section: kbMeasure.section,
      name: kbMeasure.name,
      unit: kbMeasure.unit,
      kind: kbMeasure.kind,
      inverted: kbMeasure.inverted,
      rule: kbMeasure.rule,
      direction: kbMeasure.direction,
      note: kbMeasure.note,
    })
    .from(kbMeasure)
    .where(eq(kbMeasure.kbVersionId, versionId))
    .orderBy(asc(kbMeasure.region), asc(kbMeasure.rowNumber));
  const specialTests = await db
    .select({
      key: kbSpecialTest.key,
      region: kbSpecialTest.region,
      category: kbSpecialTest.category,
      test: kbSpecialTest.test,
      targets: kbSpecialTest.targets,
      positiveFinding: kbSpecialTest.positiveFinding,
      clinicalNote: kbSpecialTest.clinicalNote,
    })
    .from(kbSpecialTest)
    .where(eq(kbSpecialTest.kbVersionId, versionId))
    .orderBy(asc(kbSpecialTest.region), asc(kbSpecialTest.rowNumber));
  return { measures, specialTests };
}

/**
 * The Assessment's knowledge in a version (CLN-06): every condition with its synonyms, mapped
 * category and each workbook's row for it (its name there and its biomechanical cause), and the
 * client's diagnosis categories in their order. Read under row level security: those who view
 * the knowledge base.
 */
export async function knowledgeAssessment(
  db: DbOrTransaction,
  versionId: string,
): Promise<AssessmentCatalog> {
  const conditions = await db
    .select({
      conditionId: kbCondition.conditionId,
      name: kbCondition.name,
      synonyms: kbCondition.synonyms,
      homeRegion: kbCondition.homeRegion,
      categoryCode: kbCondition.categoryCode,
    })
    .from(kbCondition)
    .where(eq(kbCondition.kbVersionId, versionId))
    .orderBy(asc(kbCondition.name));
  const listings = await db
    .select({
      conditionId: kbConditionListing.conditionId,
      region: kbConditionListing.region,
      name: kbConditionListing.name,
      biomechanicalCause: kbConditionListing.biomechanicalCause,
      specificExercise: sql<
        string | null
      >`${kbConditionListing.details} -> 'specific_exercise' ->> 'text'`,
    })
    .from(kbConditionListing)
    .where(eq(kbConditionListing.kbVersionId, versionId))
    .orderBy(asc(kbConditionListing.region), asc(kbConditionListing.rowNumber));
  const categories = await db
    .select({ code: kbDiagnosisCategory.code, name: kbDiagnosisCategory.name })
    .from(kbDiagnosisCategory)
    .where(eq(kbDiagnosisCategory.kbVersionId, versionId))
    .orderBy(asc(kbDiagnosisCategory.sort));
  const byCondition = new Map<string, AssessmentCondition['listings']>();
  for (const { conditionId, ...listing } of listings) {
    byCondition.set(conditionId, [...(byCondition.get(conditionId) ?? []), listing]);
  }
  return {
    conditions: conditions.map((condition) => ({
      ...condition,
      listings: byCondition.get(condition.conditionId) ?? [],
    })),
    categories,
  };
}

/**
 * The Plan's knowledge in a version (CLN-07): the modalities with the precautions each warns
 * about, and the outcome questionnaires, in the catalog's order. Read under row level security:
 * those who view the knowledge base.
 */
export async function knowledgePlan(db: DbOrTransaction, versionId: string): Promise<PlanCatalog> {
  const modalities = await db
    .select({
      key: kbModality.key,
      name: kbModality.name,
      precautions: kbModality.precautions,
      signedOff: kbModality.signedOff,
    })
    .from(kbModality)
    .where(eq(kbModality.kbVersionId, versionId))
    .orderBy(asc(kbModality.sort));
  const questionnaires = await db
    .select({
      key: kbQuestionnaire.key,
      name: kbQuestionnaire.name,
      regions: kbQuestionnaire.regions,
      useFor: kbQuestionnaire.useFor,
    })
    .from(kbQuestionnaire)
    .where(eq(kbQuestionnaire.kbVersionId, versionId))
    .orderBy(asc(kbQuestionnaire.sort));
  return { modalities, questionnaires };
}
