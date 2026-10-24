import { desc } from 'drizzle-orm';
import { setAuditContext, systemActor } from '../audit';
import {
  kbCondition,
  kbConditionListing,
  kbMeasure,
  kbRedFlagPresentation,
  kbRedFlagRule,
  kbSpecialTest,
  kbVersion,
  type KnowledgeSource,
} from '../schema';
import type { DbOrTransaction } from '../versioned';
import type { BuiltKnowledge } from './build';
import type { BuiltObjective } from './objective';
import type { RedFlags } from './red-flags';
import type { ImportReport } from './report';
import { IMPORTED_SHEETS } from './workbook';

/** The audit actor every import writes as. */
export const KB_IMPORT_ACTOR = systemActor('kb-import');

/** The latest version was imported from these very files (workbooks and rules). */
export class AlreadyImportedError extends Error {
  override name = 'AlreadyImportedError';
  constructor(readonly number: number) {
    super(`These workbooks and rules are already imported as knowledge base version ${number}.`);
  }
}

// The same files read for the same sheets: a sheet added to the import (CLN-05) makes a new version.
const sameSource = (a: KnowledgeSource, b: KnowledgeSource) =>
  JSON.stringify(a.files) === JSON.stringify(b.files) &&
  JSON.stringify(a.sheets ?? []) === JSON.stringify(b.sheets ?? []);

/**
 * Records the built knowledge base as the next version, a draft, inside the caller's transaction
 * and audited as `system:kb-import`: conditions, listings, red flag rules and presentations, and
 * the Objective's measures and special tests (CLN-05).
 * Refuses when the latest version came from the same files (the workbooks and the rules file).
 * Returns the new version's number and id.
 */
export async function applyKnowledge(
  tx: DbOrTransaction,
  built: BuiltKnowledge,
  report: ImportReport,
  redFlags: RedFlags,
  objective: BuiltObjective,
): Promise<{ id: string; number: number }> {
  await setAuditContext(tx, { actor: KB_IMPORT_ACTOR });
  const source: KnowledgeSource = {
    files: [
      ...report.files.map((f) => ({ name: f.fileName, sha256: f.sha256 })),
      redFlags.rulesFile,
    ],
    sheets: IMPORTED_SHEETS,
  };
  const [latest] = await tx
    .select({ number: kbVersion.number, source: kbVersion.source })
    .from(kbVersion)
    .orderBy(desc(kbVersion.number))
    .limit(1);
  if (latest && sameSource(latest.source, source)) throw new AlreadyImportedError(latest.number);

  const number = (latest?.number ?? 0) + 1;
  const [version] = await tx
    .insert(kbVersion)
    .values({
      number,
      source,
      report: report as unknown as Record<string, unknown>,
      createdBy: KB_IMPORT_ACTOR,
    })
    .returning({ id: kbVersion.id });
  if (!version) throw new Error('The knowledge base version was not recorded.');

  await tx
    .insert(kbCondition)
    .values(built.conditions.map((condition) => ({ ...condition, kbVersionId: version.id })));
  await tx.insert(kbConditionListing).values(
    built.listings.map(({ agePlain: _agePlain, ...listing }) => ({
      ...listing,
      kbVersionId: version.id,
    })),
  );
  await tx.insert(kbRedFlagRule).values(
    redFlags.rules.map(({ key, ...rule }) => ({
      ...rule,
      ruleKey: key,
      kbVersionId: version.id,
    })),
  );
  await tx.insert(kbRedFlagPresentation).values(
    redFlags.presentations.map((row) => ({
      kbVersionId: version.id,
      region: row.region,
      rowNumber: row.rowNumber,
      kind: row.kind,
      presentation: row.presentation,
      features: row.kind === 'presentation' ? row.features : null,
      action: row.kind === 'presentation' ? row.action : null,
      why: row.kind === 'presentation' ? row.why : null,
    })),
  );
  await tx
    .insert(kbMeasure)
    .values(objective.measures.map((measure) => ({ ...measure, kbVersionId: version.id })));
  await tx
    .insert(kbSpecialTest)
    .values(objective.specialTests.map((test) => ({ ...test, kbVersionId: version.id })));
  return { id: version.id, number };
}
