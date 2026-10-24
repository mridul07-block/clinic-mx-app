import { createHash } from 'node:crypto';
import { planCatalogFileSchema, type PlanCatalogFile } from '@clinic-mx/schemas';
import { KnowledgeImportError } from './build';
import { PLAN_CATALOG_FILE_NAME } from './paths';

/**
 * The plan catalog in a knowledge base version (CLN-07): the modalities a plan of care may include,
 * with the precautions each warns about, and the outcome questionnaires, from the committed file.
 * The file's hash is part of the version's source.
 */

export interface BuiltPlanCatalog {
  modalities: (PlanCatalogFile['modalities'][number] & { sort: number })[];
  questionnaires: (PlanCatalogFile['questionnaires'][number] & { sort: number })[];
  file: { name: string; sha256: string };
}

/** Reads and checks the plan catalog file; every problem stops the import. */
export function buildPlanCatalog(text: string): BuiltPlanCatalog {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new KnowledgeImportError([
      `${PLAN_CATALOG_FILE_NAME}: not valid JSON (${(error as Error).message})`,
    ]);
  }
  const parsed = planCatalogFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new KnowledgeImportError(
      parsed.error.issues.map(
        (issue) => `${PLAN_CATALOG_FILE_NAME}: ${issue.path.join('.')} ${issue.message}`,
      ),
    );
  }
  const { modalities, questionnaires } = parsed.data;
  const problems: string[] = [];
  for (const [kind, keys] of [
    ['modality', modalities.map((m) => m.key)],
    ['questionnaire', questionnaires.map((q) => q.key)],
  ] as const) {
    for (const key of new Set(keys)) {
      if (keys.filter((k) => k === key).length > 1) {
        problems.push(`${PLAN_CATALOG_FILE_NAME}: ${kind} "${key}" appears twice`);
      }
    }
  }
  for (const modality of modalities) {
    const links = modality.precautions.map((p) => p.precaution);
    if (new Set(links).size !== links.length) {
      problems.push(`${PLAN_CATALOG_FILE_NAME}: ${modality.key} lists a precaution twice`);
    }
  }
  if (problems.length > 0) throw new KnowledgeImportError(problems);
  return {
    modalities: modalities.map((modality, sort) => ({ ...modality, sort })),
    questionnaires: questionnaires.map((questionnaire, sort) => ({ ...questionnaire, sort })),
    file: {
      name: PLAN_CATALOG_FILE_NAME,
      sha256: createHash('sha256').update(text).digest('hex'),
    },
  };
}
