import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { knowledgeRegionKeys, knowledgeRegions, type KnowledgeRegion } from '@clinic-mx/schemas';
import ExcelJS from 'exceljs';

/**
 * Reads four sheets of each of the nine workbooks: the Master Matrix (SET-05; each row that names
 * a condition is one listing), Red Flags (SET-10; each row is one presentation), Special Tests
 * (CLN-05; each row is one test; the Bone Stress workbook has none) and the Progress Tracker
 * (CLN-05; its measure sections, read with each cell's formula). In the first three, row 1 is the
 * title, row 2 a note and row 3 the header. Cell text is kept word for word, with line endings
 * made `\n` and the ends trimmed.
 */

export const MASTER_SHEET = 'Master Matrix';
export const RED_FLAGS_SHEET = 'Red Flags';
export const SPECIAL_TESTS_SHEET = 'Special Tests';
export const TRACKER_SHEET = 'Progress Tracker';
/** The sheets an import reads, recorded with its source so a new sheet makes a new version. */
/** The Progress Tracker's readiness section, read since OUT-08: a new reading makes a new version. */
export const READINESS_READING = `${TRACKER_SHEET} (readiness)`;
export const IMPORTED_SHEETS = [
  MASTER_SHEET,
  RED_FLAGS_SHEET,
  SPECIAL_TESTS_SHEET,
  TRACKER_SHEET,
  READINESS_READING,
];
/** The Progress Tracker's columns A to G: name, two values, unit, result, status, note. */
const TRACKER_WIDTH = 7;
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

/** A Progress Tracker cell: its text (a formula's result) and its formula, if any. */
export interface TrackerCell {
  text: string;
  formula?: string;
}

export interface TrackerRow {
  rowNumber: number;
  cells: TrackerCell[];
}

/**
 * A workbook: its Master Matrix as `title`, `header` and `rows`, its Red Flags sheet, its Special
 * Tests sheet when it has one, and its Progress Tracker's rows.
 */
export interface Workbook extends Sheet {
  region: KnowledgeRegion;
  fileName: string;
  sha256: string;
  redFlags: Sheet;
  specialTests: Sheet | undefined;
  tracker: TrackerRow[];
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

/** Reads the Progress Tracker's rows with any text, columns A to G, each with its formula. */
function readTracker(book: ExcelJS.Workbook, fileName: string): TrackerRow[] {
  const sheet = book.getWorksheet(TRACKER_SHEET);
  if (!sheet) throw new Error(`${fileName} has no "${TRACKER_SHEET}" sheet.`);
  const rows: TrackerRow[] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cells = Array.from({ length: TRACKER_WIDTH }, (_, i): TrackerCell => {
      const cell = row.getCell(i + 1);
      // `formula` translates a shared formula to this cell, as Excel would.
      const formula = cell.type === ExcelJS.ValueType.Formula ? cell.formula : undefined;
      return formula ? { text: cellText(cell.value), formula } : { text: cellText(cell.value) };
    });
    if (cells.some((cell) => cell.text !== '' || cell.formula)) rows.push({ rowNumber, cells });
  }
  return rows;
}

/** Reads one workbook's Master Matrix, Red Flags, Special Tests and Progress Tracker sheets. */
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
    specialTests: book.getWorksheet(SPECIAL_TESTS_SHEET)
      ? readSheet(book, SPECIAL_TESTS_SHEET, fileName)
      : undefined,
    tracker: readTracker(book, fileName),
  };
}

/** Reads all nine workbooks in region order. */
export async function readWorkbooks(folder: string): Promise<Workbook[]> {
  const files = await workbookFiles(folder);
  return Promise.all(
    knowledgeRegionKeys.map((region) => readWorkbook(folder, files.get(region) as string, region)),
  );
}
