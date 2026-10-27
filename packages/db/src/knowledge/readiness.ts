import type { KnowledgeMeasure, ReadinessCriterion, ReadinessRule } from '@clinic-mx/schemas';
import { headerText, type TrackerRow, type Workbook } from './workbook';

/**
 * Reads each Progress Tracker's readiness section (OUT-08; user decisions 27 October 2026), from
 * its title ("… READINESS …") to its "OVERALL" row, into the region's criteria:
 *
 * - a count line (`COUNT` or `COUNTIF` over a range) names measure rows: each measure is a criterion
 *   judged by its own rule, or, for a "Baseline | Current" row, by its target or MCID column as its
 *   status formula reads it; a count over yes or no screen rows ("Red flags positive") is one
 *   criterion, Met when none is positive;
 * - a yes or no line is a criterion the consultant marks;
 * - the threshold line is the measures' own rule, so it is skipped;
 * - yes or no rows outside the section that only the overall verdict names (all of them YES, or
 *   one that must be YES) are criteria too, after the section's.
 *
 * Text is kept word for word. A line or formula that matches none of these stops the import, so
 * nothing is guessed.
 */

export type BuiltCriterion = ReadinessCriterion & { position: number; rowNumber: number };

const RANGE = /\$?([A-G])\$?(\d+):\$?([A-G])\$?(\d+)/g;
const COUNT_PART = /^COUNT(?:IF)?\([^)]*\)$/;
/** A count line: one `COUNT` or `COUNTIF`, or several added together. */
const isCountLine = (formula: string) => formula.split('+').every((part) => COUNT_PART.test(part));
const COUNT_YES = /^COUNTIF\(B\d+:B\d+,"YES"\)$/;
const STATUS_TARGET = /^IF\(OR\(C(\d+)="",F\1=""\),"",IF\(C\1>=F\1,"MET","NOT YET"\)\)$/;
const STATUS_MCID =
  /^IF\(OR\(B(\d+)="",C\1=""\),"",IF\((B\1-C\1|C\1-B\1)>=F\1,"MCID MET","NOT YET"\)\)$/;
const ALL_YES = /COUNTIF\(B(\d+):B(\d+),"YES"\)=(\d+)/g;
const MUST_YES = /B(\d+)<>"YES"/g;
const THRESHOLD = /threshold/i;
const isYesNo = (text: string | undefined) => text === 'YES' || text === 'NO';

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

/** One workbook's readiness criteria, given its measures (with their rows). */
export function readReadiness(
  workbook: Workbook,
  measures: readonly (KnowledgeMeasure & { rowNumber: number })[],
  isTitle: (row: TrackerRow) => boolean,
  problems: string[],
): BuiltCriterion[] {
  const where = (row: number) => `${workbook.fileName}, Progress Tracker row ${String(row)}`;
  const rows = workbook.tracker;
  const byRow = new Map(rows.map((row) => [row.rowNumber, row]));
  const titleAbove = (rowNumber: number) =>
    headerText(
      rows.filter((row) => row.rowNumber < rowNumber && isTitle(row)).at(-1)?.cells[0]?.text ?? '',
    );
  const start = rows.findIndex(
    (row) => row.rowNumber > 2 && isTitle(row) && /READINESS/.test(row.cells[0]?.text ?? ''),
  );
  const title = rows[start];
  if (!title) {
    problems.push(`${workbook.fileName}, Progress Tracker: no readiness section.`);
    return [];
  }
  const section = headerText(title.cells[0]?.text ?? '');
  const criteria: BuiltCriterion[] = [];
  const add = (criterion: Omit<BuiltCriterion, 'position' | 'region'>) => {
    if (criteria.some((c) => c.key === criterion.key)) return;
    criteria.push({ ...criterion, region: workbook.region, position: criteria.length + 1 });
  };
  const check = (row: TrackerRow, rule: ReadinessRule, fromVerdict: boolean, inSection: string) => {
    add({
      key: `${workbook.region}.readiness.${slug(row.cells[0]?.text ?? '')}`,
      kind: 'check',
      measureKey: null,
      text: row.cells[0]?.text ?? '',
      section: inSection,
      rule,
      fromVerdict,
      rowNumber: row.rowNumber,
    });
  };
  const rowsIn = (formula: string) =>
    [...formula.matchAll(RANGE)].flatMap(([, , from = '0', , to = '0']) =>
      rows.filter((row) => row.rowNumber >= Number(from) && row.rowNumber <= Number(to)),
    );

  let overall: TrackerRow | undefined;
  for (const row of rows.slice(start + 1)) {
    const [a, b, c] = row.cells;
    const text = a?.text ?? '';
    if (text.startsWith('OVERALL')) {
      overall = row;
      break;
    }
    if (!text) continue;
    if (b?.formula && isCountLine(b.formula)) {
      const named = rowsIn(b.formula);
      if (named.every((n) => isYesNo(n.cells[1]?.text)) && COUNT_YES.test(b.formula)) {
        check(row, { kind: 'none_positive' }, false, section);
        continue;
      }
      for (const n of named) {
        const measure = measures.find((m) => m.rowNumber === n.rowNumber);
        if (!measure) {
          problems.push(
            `${where(row.rowNumber)}: "${text}" counts row ${String(n.rowNumber)}, which is not a measure.`,
          );
          continue;
        }
        const rule = ruleOf(measure, n);
        if (!rule) {
          problems.push(
            `${where(n.rowNumber)}: the status of "${measure.name}" matches no known rule.`,
          );
          continue;
        }
        add({
          key: measure.key,
          kind: 'measure',
          measureKey: measure.key,
          text: measure.name,
          section: measure.section,
          rule,
          fromVerdict: false,
          rowNumber: n.rowNumber,
        });
      }
      continue;
    }
    if (!b?.formula && isYesNo(b?.text) && !c?.formula) {
      check(row, { kind: 'yes' }, false, section);
      continue;
    }
    if (!b?.formula && THRESHOLD.test(text)) continue;
    problems.push(`${where(row.rowNumber)}: the readiness line "${text}" matches nothing known.`);
  }
  if (!overall) {
    problems.push(
      `${workbook.fileName}, Progress Tracker: no OVERALL row after the readiness section.`,
    );
    return criteria;
  }
  // Yes or no rows outside the section that the overall verdict needs to be YES.
  const verdict = overall.cells[2]?.formula ?? overall.cells[1]?.formula ?? '';
  const needed: number[] = [];
  for (const [, from = '0', to = '0', count = '0'] of verdict.matchAll(ALL_YES)) {
    if (Number(to) - Number(from) + 1 !== Number(count)) continue;
    for (let n = Number(from); n <= Number(to); n++) needed.push(n);
  }
  for (const [, n = '0'] of verdict.matchAll(MUST_YES)) needed.push(Number(n));
  for (const n of needed) {
    if (n > title.rowNumber) continue;
    const row = byRow.get(n);
    if (!row || !isYesNo(row.cells[1]?.text)) {
      problems.push(
        `${where(overall.rowNumber)}: the verdict needs row ${String(n)}, which is not a yes or no row.`,
      );
      continue;
    }
    check(row, { kind: 'yes' }, true, titleAbove(n));
  }
  return criteria;
}

/** A counted measure's rule: its own, or a "Baseline | Current" row's target or MCID. */
function ruleOf(measure: KnowledgeMeasure, row: TrackerRow): ReadinessRule | undefined {
  if (measure.kind !== 'marker' && measure.kind !== 'grade') return { kind: 'measure' };
  const status = row.cells[6]?.formula ?? '';
  const column = Number(row.cells[5]?.text ?? '');
  if (row.cells[5]?.text === '' || Number.isNaN(column)) return undefined;
  if (STATUS_TARGET.test(status)) return { kind: 'target', target: column };
  const mcid = STATUS_MCID.exec(status);
  if (mcid) {
    return { kind: 'mcid', mcid: column, better: mcid[2]?.startsWith('B') ? 'lower' : 'higher' };
  }
  return undefined;
}
