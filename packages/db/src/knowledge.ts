import { asc, desc, eq } from 'drizzle-orm';
import { kbCondition, kbConditionListing, kbVersion } from './schema';
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
