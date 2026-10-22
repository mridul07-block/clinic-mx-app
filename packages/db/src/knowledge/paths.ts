import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConditionIds } from './build';

/** Where the import reads and writes, from the repository root. */
const repo = join(import.meta.dirname, '..', '..', '..', '..');

export const WORKBOOK_FOLDER_PATH = join(repo, 'docs', 'Joint wise AI Training');
export const ID_FILE_PATH = join(import.meta.dirname, 'condition-ids.json');
export const REPORT_FILE_PATH = join(repo, 'docs', 'knowledge-base', 'import-report.md');

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
