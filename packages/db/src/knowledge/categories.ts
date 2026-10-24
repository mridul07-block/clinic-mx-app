import { createHash } from 'node:crypto';
import { diagnosisCategoriesFileSchema } from '@clinic-mx/schemas';
import { KnowledgeImportError, type BuiltKnowledge } from './build';
import { CATEGORIES_FILE_NAME } from './paths';

/**
 * The client's diagnosis categories in a knowledge base version (CLN-06): its list word for word
 * from the committed categories file, and each condition's category where the file maps one
 * (SET-12 adds the client's mapping). The file's hash is part of the version's source.
 */

export interface BuiltCategories {
  categories: { code: string; name: string; sort: number }[];
  /** Condition ID to category code; empty until SET-12. */
  mapping: Record<string, string>;
  file: { name: string; sha256: string };
}

/** Reads and checks the categories file against the build; every problem stops the import. */
export function buildCategories(text: string, built: BuiltKnowledge): BuiltCategories {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new KnowledgeImportError([
      `${CATEGORIES_FILE_NAME}: not valid JSON (${(error as Error).message})`,
    ]);
  }
  const parsed = diagnosisCategoriesFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new KnowledgeImportError(
      parsed.error.issues.map(
        (issue) => `${CATEGORIES_FILE_NAME}: ${issue.path.join('.')} ${issue.message}`,
      ),
    );
  }
  const { categories, conditions } = parsed.data;
  const problems: string[] = [];
  const codes = new Set<string>();
  for (const { code } of categories) {
    if (codes.has(code)) problems.push(`${CATEGORIES_FILE_NAME}: code "${code}" appears twice`);
    codes.add(code);
  }
  const known = new Set(built.conditions.map((condition) => condition.conditionId));
  for (const [conditionId, code] of Object.entries(conditions)) {
    if (!known.has(conditionId)) {
      problems.push(`${CATEGORIES_FILE_NAME}: ${conditionId} is not a condition in the workbooks`);
    }
    if (!codes.has(code)) {
      problems.push(`${CATEGORIES_FILE_NAME}: ${conditionId} maps to unknown category "${code}"`);
    }
  }
  if (problems.length > 0) throw new KnowledgeImportError(problems);
  return {
    categories: categories.map((category, sort) => ({ ...category, sort })),
    mapping: conditions,
    file: { name: CATEGORIES_FILE_NAME, sha256: createHash('sha256').update(text).digest('hex') },
  };
}
