import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConditionIds } from './build';

/** Where the import reads and writes, from the repository root. */
const repo = join(import.meta.dirname, '..', '..', '..', '..');

export const WORKBOOK_FOLDER_PATH = join(repo, 'docs', 'Joint wise AI Training');
export const ID_FILE_PATH = join(import.meta.dirname, 'condition-ids.json');
export const REPORT_FILE_PATH = join(repo, 'docs', 'knowledge-base', 'import-report.md');
export const RULES_FILE_NAME = 'red-flag-rules.json';
export const RULES_FILE_PATH = join(import.meta.dirname, RULES_FILE_NAME);
export const CATEGORIES_FILE_NAME = 'diagnosis-categories.json';
export const CATEGORIES_FILE_PATH = join(import.meta.dirname, CATEGORIES_FILE_NAME);
export const PLAN_CATALOG_FILE_NAME = 'plan-catalog.json';
export const PLAN_CATALOG_FILE_PATH = join(import.meta.dirname, PLAN_CATALOG_FILE_NAME);

/** The committed red flag rules file, as written (SET-10). */
export function readRulesFile(): Promise<string> {
  return readFile(RULES_FILE_PATH, 'utf8');
}

/** The committed diagnosis categories file, as written (CLN-06). */
export function readCategoriesFile(): Promise<string> {
  return readFile(CATEGORIES_FILE_PATH, 'utf8');
}

/** The committed plan catalog file, as written (CLN-07). */
export function readPlanCatalogFile(): Promise<string> {
  return readFile(PLAN_CATALOG_FILE_PATH, 'utf8');
}

/** The committed ID file; empty before the first import. */
export async function readConditionIds(): Promise<ConditionIds> {
  try {
    return JSON.parse(await readFile(ID_FILE_PATH, 'utf8')) as ConditionIds;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function writeConditionIds(ids: ConditionIds): Promise<void> {
  await writeFile(ID_FILE_PATH, `${JSON.stringify(ids, null, 2)}\n`);
}

/** The committed import report, as Markdown. */
export function readReport(): Promise<string> {
  return readFile(REPORT_FILE_PATH, 'utf8');
}

export async function writeReport(markdown: string): Promise<void> {
  await mkdir(dirname(REPORT_FILE_PATH), { recursive: true });
  await writeFile(REPORT_FILE_PATH, markdown);
}
