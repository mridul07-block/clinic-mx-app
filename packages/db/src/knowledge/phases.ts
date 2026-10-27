import type { PhaseCriterion, ProgrammePhase } from '@clinic-mx/schemas';
import { PHASED_SHEET, type Workbook } from './workbook';

/**
 * Reads each workbook's Phased Programme sheet (OUT-04 with SET-09; user decisions 27 October
 * 2026): one phase per "Phase n" row from row 4, numbered from 0 without a gap, up to the first row
 * that is not a phase (the sheet's treatment algorithm below). Each phase's Exit Criteria cell is
 * split on `;` into its lines, kept word for word; a line naming acceptable pain on loading is
 * flagged for the decision 4 hint. A header or phase row that does not read stops the import, so
 * nothing is guessed. The Bone Stress workbook has no such sheet, so no phases.
 */

export type BuiltPhase = ProgrammePhase & { rowNumber: number };
export type BuiltPhaseCriterion = PhaseCriterion & { rowNumber: number };

export const PHASED_HEADER = [
  'Phase',
  'Name',
  'Typical Timing',
  'Goal',
  'Content',
  'Markers Tracked',
  'Exit Criteria',
];

const PHASE = /^Phase (\d+)$/;
const PAIN_LIMIT = /acceptable[ -]pain|<=\s*\d+\/10/i;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

/** One workbook's phases and their exit criteria; problems stop the import. */
export function readPhases(
  workbook: Workbook,
  problems: string[],
): { phases: BuiltPhase[]; criteria: BuiltPhaseCriterion[] } {
  const sheet = workbook.phased;
  if (!sheet) return { phases: [], criteria: [] };
  const where = (row: number) => `${workbook.fileName}, ${PHASED_SHEET} row ${String(row)}`;
  if (JSON.stringify(sheet.header) !== JSON.stringify(PHASED_HEADER)) {
    problems.push(
      `${workbook.fileName}, ${PHASED_SHEET}: the header "${sheet.header.join(' | ')}" is not the one read.`,
    );
    return { phases: [], criteria: [] };
  }
  const phases: BuiltPhase[] = [];
  const criteria: BuiltPhaseCriterion[] = [];
  for (const { rowNumber, cells } of sheet.rows) {
    const [label = '', name = '', timing = '', goal = '', content = '', markers = '', exit = ''] =
      cells;
    if (!label.startsWith('Phase')) break;
    const number = PHASE.exec(label)?.[1];
    if (number === undefined || Number(number) !== phases.length) {
      problems.push(`${where(rowNumber)}: "${label}" is not Phase ${String(phases.length)}.`);
      break;
    }
    const lines = exit
      .split(';')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!name || lines.length === 0) {
      problems.push(`${where(rowNumber)}: a phase needs its name and exit criteria.`);
      continue;
    }
    const phase = phases.length;
    phases.push({
      region: workbook.region,
      number: phase,
      name,
      timing,
      goal,
      content,
      markers,
      rowNumber,
    });
    const keys = new Set<string>();
    lines.forEach((text, position) => {
      const key = `${workbook.region}.phase${String(phase)}.${slug(text)}`;
      if (keys.has(key)) problems.push(`${where(rowNumber)}: the line "${text}" is there twice.`);
      keys.add(key);
      criteria.push({
        key,
        region: workbook.region,
        phase,
        position,
        text,
        namesPainLimit: PAIN_LIMIT.test(text),
        rowNumber,
      });
    });
  }
  if (phases.length === 0) problems.push(`${workbook.fileName}, ${PHASED_SHEET}: no phases read.`);
  return { phases, criteria };
}
