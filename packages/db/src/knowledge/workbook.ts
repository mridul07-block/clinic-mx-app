import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { knowledgeRegionKeys, knowledgeRegions, type KnowledgeRegion } from '@clinic-mx/schemas';
import ExcelJS from 'exceljs';

/**
 * Reads two sheets of each of the nine workbooks: the Master Matrix (SET-05; each row that names a
 * condition is one listing) and Red Flags (SET-10; each row is one presentation). In both, row 1 is
 * the title, row 2 a note and row 3 the header. Cell text is kept word for word, with line endings
 * made `\n` and the ends trimmed.
 */

export const MASTER_SHEET = 'Master Matrix';
export const RED_FLAGS_SHEET = 'Red Flags';
const HEADER_ROW = 3;

export interface WorkbookRow {
  /** The row as Excel numbers it. */
  rowNumber: number;
  /** One text per header column, '' for an empty cell. */
  cells: string[];
}

export interface Sheet {
  /** The sheet's title row, for example "… — 40 SHOULDER CONDITIONS". */
  title: string;
  header: string[];
  rows: WorkbookRow[];
}

/** A workbook: its Master Matrix as `title`, `header` and `rows`, and its Red Flags sheet. */
export interface Workbook extends Sheet {
  region: KnowledgeRegion;
  fileName: string;
  sha256: string;
  redFlags: Sheet;
}

/** The text of a cell however Excel stored it: plain, rich text, a formula's result or a link. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return tidy(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return tidy(value.richText.map((part) => part.text).join(''));
  if ('text' in value && typeof value.text === 'string') return tidy(value.text);
  if ('result' in value) return cellText(value.result);
  return '';
}

const tidy = (text: string) => text.replace(/\r\n?/g, '\n').trim();

/** A header as compared: one space between words. */
export const headerText = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The workbook file for each region in a folder, found by its leading number ("1 Shoulder…"). */
export async function workbookFiles(folder: string): Promise<Map<KnowledgeRegion, string>> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the workbook folder in this repository
  const names = (await readdir(folder)).filter((name) => name.endsWith('.xlsx'));
  const files = new Map<KnowledgeRegion, string>();
  for (const region of knowledgeRegionKeys) {
    const number = knowledgeRegions[region].file;
    const matches = names.filter((name) => name.startsWith(`${number} `));
    if (matches.length !== 1) {
      throw new Error(
        `Expected one workbook starting "${number} " for ${region}, found ${matches.length}.`,
      );
    }
    files.set(region, matches[0] as string);
  }
  return files;
}

/** Reads a sheet's title, header and the rows below it that have any text. */
function readSheet(book: ExcelJS.Workbook, name: string, fileName: string): Sheet {
  const sheet = book.getWorksheet(name);
  if (!sheet) throw new Error(`${fileName} has no "${name}" sheet.`);
  const textsOf = (rowNumber: number, width: number) => {
    const row = sheet.getRow(rowNumber);
    return Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1).value));
  };
  const width = sheet.getRow(HEADER_ROW).cellCount;
  const header = textsOf(HEADER_ROW, width).map(headerText);
  const rows: WorkbookRow[] = [];
  for (let rowNumber = HEADER_ROW + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const cells = textsOf(rowNumber, width);
    if (cells.some((cell) => cell !== '')) rows.push({ rowNumber, cells });
  }
  return { title: headerText(cellText(sheet.getRow(1).getCell(1).value)), header, rows };
}

/** Reads one workbook's Master Matrix and Red Flags sheets. */
export async function readWorkbook(
  folder: string,
  fileName: string,
  region: KnowledgeRegion,
): Promise<Workbook> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a workbook found in that folder
  const bytes = await readFile(join(folder, fileName));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return {
    region,
    fileName,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...readSheet(book, MASTER_SHEET, fileName),
    redFlags: readSheet(book, RED_FLAGS_SHEET, fileName),
  };
}

/** Reads all nine workbooks in region order. */
export async function readWorkbooks(folder: string): Promise<Workbook[]> {
  const files = await workbookFiles(folder);
  return Promise.all(
    knowledgeRegionKeys.map((region) => readWorkbook(folder, files.get(region) as string, region)),
  );
}
