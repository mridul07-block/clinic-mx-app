import type {
  KnowledgeMeasure,
  KnowledgeRegion,
  KnowledgeSpecialTest,
  MeasureKind,
  MeasureRule,
} from '@clinic-mx/schemas';
import { KnowledgeImportError } from './build';
import { readReadiness, type BuiltCriterion } from './readiness';
import { headerText, type TrackerRow, type Workbook } from './workbook';

/**
 * The Objective's knowledge (CLN-05): each workbook's measures, read from its Progress Tracker,
 * and its special tests, read from its Special Tests sheet. A measure section is a title row, then
 * a header row naming its columns, then its rows; the section's header and each row's formulas
 * decide how the measure is read (decisions 24 October 2026):
 *
 * - "Involved | Uninvolved" with `B/C` (or `C/B`, a timed test) and PASS at a target: an LSI;
 * - "Involved | Uninvolved" with `C-B` (or its size) banded SYMMETRICAL / MILD DEFICIT / RESTRICTED:
 *   a deficit;
 * - "Measured | Normal ref" or "Achieved | Target": one value against the row's reference;
 * - "Baseline | Current": a marker with its direction; a "(0-3)" grade is a quality rating.
 *
 * Sections without such a header (yes or no screens, ratios, readiness) and rows without a unit
 * (end-feel, yes or no checks) or with a computed value are not measures and are listed as
 * skipped. A header or formula that matches none of these stops the import, so nothing is guessed.
 */

export interface SkippedRows {
  region: KnowledgeRegion;
  rowNumber: number;
  text: string;
  why: 'section' | 'row';
}

export interface BuiltObjective {
  measures: (KnowledgeMeasure & { rowNumber: number })[];
  specialTests: (KnowledgeSpecialTest & { rowNumber: number })[];
  /** Each region's readiness criteria (OUT-08, `./readiness`). */
  readiness: BuiltCriterion[];
  skipped: SkippedRows[];
}

type SectionShape = 'paired' | 'reference' | 'marker';

const HEADERS: { shape: SectionShape; first: string[]; second: string[] }[] = [
  {
    shape: 'paired',
    first: ['Involved', 'Involved side'],
    second: ['Uninvolved', 'Uninvolved / previous'],
  },
  {
    shape: 'reference',
    first: ['Measured', 'Achieved'],
    second: ['Normal ref', 'Target', 'Target / Normal'],
  },
  { shape: 'marker', first: ['Baseline'], second: ['Current'] },
];
const NAME_HEADERS = ['Measure', 'Movement', 'Position', 'Marker'];
/** Rows 1 and 2 are the sheet's title and note, row 4 its patient details. */
const FIRST_SECTION_ROW = 4;

const LSI = /^IF\(N\(([BC])(\d+)\)=0,"",([BC])\2\/([BC])\2\)$/;
const LSI_STATUS = /^IF\(E\d+="","",IF\(E\d+>=(\$B\$\d+|[\d.]+),"PASS","NOT YET"\)\)$/;
const LSI_STATUS_AND =
  /^IF\(E\d+="","",IF\(AND\(E\d+>=(\$B\$\d+|[\d.]+),B\d+>=([\d.]+)\),"PASS","NOT YET"\)\)$/;
const DEFICIT = /^IF\(OR\(B\d+="",C\d+=""\),"",(?:(ABS)\(C\d+-B\d+\)|C\d+-B\d+)\)$/;
const BANDS =
  /^IF\(E\d+="","",IF\(E\d+<=([\d.]+),"(SYMMETRICAL|FULL)",IF\(E\d+<=([\d.]+),"MILD DEFICIT","RESTRICTED"\)\)\)$/;
const REFERENCE_DEFICIT = /^IF\(B\d+="","",C\d+-B\d+\)$/;
const REFERENCE_TARGET = /^IF\(B\d+="","",IF\(B\d+(>=|<=)C\d+,"PASS","NOT YET"\)\)$/;

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

export const isTitle = (row: TrackerRow) => {
  const [first, ...rest] = row.cells;
  if (!first?.text || first.formula) return false;
  return rest.every((cell) => !cell.formula && (cell.text === '' || cell.text === first.text));
};

/** Reads one workbook's Progress Tracker into its measures. */
function readMeasures(workbook: Workbook, problems: string[], skipped: SkippedRows[]) {
  const where = (row: number) => `${workbook.fileName}, Progress Tracker row ${String(row)}`;
  const byRow = new Map(workbook.tracker.map((row) => [row.rowNumber, row]));
  const numberAt = (reference: string, row: number): number | undefined => {
    if (!reference.startsWith('$B$')) return Number(reference);
    const target = byRow.get(Number(reference.slice(3)))?.cells[1]?.text ?? '';
    const value = Number(target);
    if (target === '' || Number.isNaN(value)) {
      problems.push(`${where(row)}: the target ${reference} is not a number.`);
      return undefined;
    }
    return value;
  };

  const measures: BuiltObjective['measures'] = [];
  const rows = workbook.tracker;
  for (let i = 0; i < rows.length; i++) {
    const titleRow = rows[i];
    if (!titleRow || !isTitle(titleRow)) continue;
    const title = headerText(titleRow.cells[0]?.text ?? '');
    // The instructions close the sheet; the sheet's own title and note open it.
    if (title.startsWith('HOW TO USE')) break;
    const header = rows[i + 1];
    const name = headerText(header?.cells[0]?.text ?? '');
    if (!header || isTitle(header) || !NAME_HEADERS.includes(name)) {
      if (titleRow.rowNumber > FIRST_SECTION_ROW) {
        skipped.push({
          region: workbook.region,
          rowNumber: titleRow.rowNumber,
          text: title,
          why: 'section',
        });
      }
      continue;
    }
    const [first, second] = [1, 2].map((c) => headerText(header.cells[c]?.text ?? ''));
    const shape = HEADERS.find(
      (h) => h.first.includes(first ?? '') && h.second.includes(second ?? ''),
    );
    if (!shape) {
      problems.push(
        `${where(header.rowNumber)}: the header "${first ?? ''} | ${second ?? ''}" is not known.`,
      );
      continue;
    }
    const directionColumn = headerText(header.cells[6]?.text ?? '') === 'Direction of improvement';
    for (let j = i + 2; j < rows.length; j++) {
      const row = rows[j];
      if (!row || isTitle(row)) break;
      const [a, b, c, d, e, f, g] = row.cells;
      const measureName = a?.text ?? '';
      const unit = d?.text ?? '';
      if (!measureName) continue;
      // A row with no unit, a computed value, or (beside two values) no formula at all is a
      // worded check or a figure the sheet works out, not a measure.
      const worded = shape.shape !== 'marker' && !e?.formula && !f?.formula;
      if (!unit || b?.formula || worded) {
        skipped.push({
          region: workbook.region,
          rowNumber: row.rowNumber,
          text: measureName,
          why: 'row',
        });
        continue;
      }
      const read = readRule(
        shape.shape,
        { e: e?.formula, f: f?.formula, c: c?.text ?? '' },
        (ref) => numberAt(ref, row.rowNumber),
      );
      if (!read) {
        problems.push(
          `${where(row.rowNumber)}: the formulas of "${measureName}" match no known measure.`,
        );
        continue;
      }
      const kind: MeasureKind =
        read.kind === 'marker' && unit === 'grade' && /\(0-3\)/.test(measureName)
          ? 'grade'
          : read.kind;
      measures.push({
        key: `${workbook.region}.${kind === 'grade' ? 'marker' : kind}.${slug(measureName)}`,
        region: workbook.region,
        section: title,
        name: measureName,
        unit,
        kind,
        inverted: read.inverted,
        rule: read.rule,
        direction: directionColumn && g?.text ? g.text : null,
        note: !directionColumn && shape.shape !== 'marker' && g?.text ? g.text : null,
        rowNumber: row.rowNumber,
      });
    }
  }
  return measures;
}

/** How a row is read, from its section's shape and its formulas; undefined when none matches. */
function readRule(
  shape: SectionShape,
  cells: { e: string | undefined; f: string | undefined; c: string },
  numberAt: (reference: string) => number | undefined,
): { kind: MeasureKind; inverted: boolean; rule: MeasureRule } | undefined {
  const { e = '', f = '' } = cells;
  if (shape === 'marker') return { kind: 'marker', inverted: false, rule: { kind: 'none' } };
  if (shape === 'paired') {
    const lsi = LSI.exec(e);
    if (lsi) {
      const status = LSI_STATUS.exec(f) ?? LSI_STATUS_AND.exec(f);
      const passAt = status?.[1] ? numberAt(status[1]) : undefined;
      if (passAt === undefined) return undefined;
      const minInvolved = status?.[2] ? Number(status[2]) : undefined;
      return {
        kind: 'lsi',
        inverted: lsi[3] === 'C',
        rule:
          minInvolved === undefined
            ? { kind: 'lsi', passAt }
            : { kind: 'lsi', passAt, minInvolved },
      };
    }
    const deficit = DEFICIT.exec(e);
    const bands = BANDS.exec(f);
    if (deficit && bands) {
      return {
        kind: 'deficit',
        inverted: false,
        rule: {
          kind: 'deficit',
          absolute: deficit[1] === 'ABS',
          okAt: Number(bands[1]),
          mildAt: Number(bands[3]),
          okWord: bands[2] === 'FULL' ? 'full' : 'symmetrical',
        },
      };
    }
    return undefined;
  }
  const reference = Number(cells.c);
  if (cells.c === '' || Number.isNaN(reference)) return undefined;
  const bands = BANDS.exec(f);
  if (REFERENCE_DEFICIT.test(e) && bands) {
    return {
      kind: 'reference',
      inverted: false,
      rule: {
        kind: 'reference_deficit',
        reference,
        okAt: Number(bands[1]),
        mildAt: Number(bands[3]),
        okWord: bands[2] === 'FULL' ? 'full' : 'symmetrical',
      },
    };
  }
  const target = REFERENCE_TARGET.exec(f);
  if (target) {
    return {
      kind: 'reference',
      inverted: false,
      rule: {
        kind: 'reference_target',
        reference,
        passWhen: target[1] === '>=' ? 'at_least' : 'at_most',
      },
    };
  }
  return undefined;
}

const TEST_HEADERS = {
  category: ['Category'],
  test: ['Test'],
  targets: ['Targets', 'Target Structure'],
  positiveFinding: ['Positive Finding'],
  clinicalNote: ['Clinical Note'],
} as const;

/** Reads one workbook's Special Tests sheet; a row without a category keeps the one above. */
function readSpecialTests(workbook: Workbook, problems: string[]) {
  const sheet = workbook.specialTests;
  if (!sheet) return [];
  const columns = Object.fromEntries(
    Object.entries(TEST_HEADERS).map(([field, names]) => [
      field,
      sheet.header.findIndex((header) => (names as readonly string[]).includes(header)),
    ]),
  ) as Record<keyof typeof TEST_HEADERS, number>;
  const missing = Object.entries(columns).filter(([, index]) => index < 0);
  if (missing.length > 0) {
    problems.push(
      `${workbook.fileName}, Special Tests: no ${missing.map(([field]) => field).join(', ')} column.`,
    );
    return [];
  }
  const tests: BuiltObjective['specialTests'] = [];
  let category = '';
  for (const row of sheet.rows) {
    const cell = (field: keyof typeof TEST_HEADERS) => row.cells[columns[field]] ?? '';
    category = cell('category') || category;
    const test = cell('test');
    if (!test) continue;
    tests.push({
      key: `${workbook.region}.${slug(test)}`,
      region: workbook.region,
      category,
      test,
      targets: cell('targets'),
      positiveFinding: cell('positiveFinding'),
      clinicalNote: cell('clinicalNote'),
      rowNumber: row.rowNumber,
    });
  }
  return tests;
}

/** Gives clashing keys their section or category; a clash that remains stops the import. */
function settleKeys<T extends { key: string; rowNumber: number; region: KnowledgeRegion }>(
  items: T[],
  extra: (item: T) => string,
  label: string,
  problems: string[],
) {
  const count = (key: string) => items.filter((item) => item.key === key).length;
  const clashing = new Set(items.filter((item) => count(item.key) > 1).map((item) => item.key));
  for (const item of items) {
    if (clashing.has(item.key)) item.key = `${item.key}.${slug(extra(item))}`;
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) {
      problems.push(
        `${item.region} ${label} row ${String(item.rowNumber)}: the key ${item.key} is used twice.`,
      );
    }
    seen.add(item.key);
  }
}

/** Every workbook's measures, special tests and readiness criteria; problems stop the import. */
export function buildObjective(workbooks: readonly Workbook[]): BuiltObjective {
  const problems: string[] = [];
  const skipped: SkippedRows[] = [];
  const measures = workbooks.flatMap((workbook) => readMeasures(workbook, problems, skipped));
  const specialTests = workbooks.flatMap((workbook) => readSpecialTests(workbook, problems));
  settleKeys(measures, (m) => m.section, 'Progress Tracker', problems);
  settleKeys(specialTests, (t) => t.category, 'Special Tests', problems);
  // Read after the keys are settled, so a criterion names the measure's final key.
  const readiness = workbooks.flatMap((workbook) =>
    readReadiness(
      workbook,
      measures.filter((m) => m.region === workbook.region),
      isTitle,
      problems,
    ),
  );
  if (problems.length > 0) throw new KnowledgeImportError(problems);
  return { measures, specialTests, readiness, skipped };
}
