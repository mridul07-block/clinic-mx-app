import type {
  AssessmentCatalog,
  AssessmentCondition,
  KnowledgeMeasure,
  KnowledgeSpecialTest,
} from '@clinic-mx/schemas';
import { asc, desc, eq } from 'drizzle-orm';
import {
  kbCondition,
  kbConditionListing,
  kbDiagnosisCategory,
  kbMeasure,
  kbRedFlagPresentation,
  kbRedFlagRule,
  kbSpecialTest,
  kbVersion,
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

/** The newest version, draft or approved; undefined before the first import. */
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
    .orderBy(desc(kbVersion.number))
    .limit(1);
  return version;
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
