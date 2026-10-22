import { desc } from 'drizzle-orm';
import { setAuditContext, systemActor } from '../audit';
import {
  kbCondition,
  kbConditionListing,
  kbRedFlagPresentation,
  kbRedFlagRule,
  kbVersion,
  type KnowledgeSource,
} from '../schema';
import type { DbOrTransaction } from '../versioned';
import type { BuiltKnowledge } from './build';
import type { RedFlags } from './red-flags';
import type { ImportReport } from './report';

/** The audit actor every import writes as. */
export const KB_IMPORT_ACTOR = systemActor('kb-import');

/** The latest version was imported from these very files (workbooks and rules). */
export class AlreadyImportedError extends Error {
  override name = 'AlreadyImportedError';
  constructor(readonly number: number) {
    super(`These workbooks and rules are already imported as knowledge base version ${number}.`);
  }
}

const sameSource = (a: KnowledgeSource, b: KnowledgeSource) =>
  JSON.stringify(a.files) === JSON.stringify(b.files);

/**
 * Records the built knowledge base as the next version, a draft, inside the caller's transaction
 * and audited as `system:kb-import`: conditions, listings, red flag rules and presentations.
 * Refuses when the latest version came from the same files (the workbooks and the rules file).
 * Returns the new version's number and id.
 */
export async function applyKnowledge(
  tx: DbOrTransaction,
  built: BuiltKnowledge,
  report: ImportReport,
  redFlags: RedFlags,
): Promise<{ id: string; number: number }> {
  await setAuditContext(tx, { actor: KB_IMPORT_ACTOR });
  const source: KnowledgeSource = {
    files: [
      ...report.files.map((f) => ({ name: f.fileName, sha256: f.sha256 })),
      redFlags.rulesFile,
    ],
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
  return { id: version.id, number };
}
