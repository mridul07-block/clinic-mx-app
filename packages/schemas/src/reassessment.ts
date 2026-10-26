import { z } from 'zod';
import { BASELINE_REASON_MAX, measureValueText } from './baseline';
import { lsiPercent, measureResult, type KnowledgeMeasure, type MeasureEntry } from './objective';

/**
 * The session 4 reassessment (OUT-05, PRD J5.10 and section 7 "Reassessment"; decision 7 default,
 * user decisions 26 October 2026). Session `clinical.reassessment_session` measures exactly what
 * the episode's frozen baseline holds (OUT-01), both sides of a side by side measure, each
 * recorded or Not tested with a reason before the session closes. The episode's consultant then
 * reviews baseline against now and signs a written decision.
 */

/** What session 4 needs to know of a measure it asks for. */
export type ReassessedMeasure = Pick<KnowledgeMeasure, 'key' | 'name' | 'kind' | 'unit'>;

const reading = z.number().min(-1000).max(100000).nullable().default(null);

/** Session 4's entry for one measure: its readings, or Not tested with a reason. */
export const reassessmentEntrySchema = z.object({
  involved: reading,
  uninvolved: reading,
  value: reading,
  notTested: z.boolean().default(false),
  reason: z
    .string()
    .max(BASELINE_REASON_MAX, `Keep the reason to ${String(BASELINE_REASON_MAX)} characters.`)
    .default(''),
});
export type ReassessmentEntry = z.infer<typeof reassessmentEntrySchema>;

export const emptyReassessmentEntry: ReassessmentEntry = {
  involved: null,
  uninvolved: null,
  value: null,
  notTested: false,
  reason: '',
};

/** Whether a measure takes the involved and uninvolved sides. */
export const takesBothSides = (measure: Pick<KnowledgeMeasure, 'kind'>) =>
  measure.kind === 'lsi' || measure.kind === 'deficit';

const GRADE_MAX = 3;
const isGrade = (value: number) => Number.isInteger(value) && value >= 0 && value <= GRADE_MAX;

/** What still holds session 4 back on its reassessment, in the measures' order. */
export function reassessmentBlockers(
  entries: Readonly<Record<string, ReassessmentEntry>>,
  measures: readonly ReassessedMeasure[],
): string[] {
  return measures.flatMap((measure) => {
    const entry = entries[measure.key] ?? emptyReassessmentEntry;
    if (entry.notTested) {
      return entry.reason.trim() === '' ? [`Give the reason ${measure.name} was not tested.`] : [];
    }
    if (takesBothSides(measure)) {
      return entry.involved === null || entry.uninvolved === null
        ? [`Record both sides of ${measure.name}, or mark it Not tested with a reason.`]
        : [];
    }
    if (entry.value === null) {
      return [`Record ${measure.name}, or mark it Not tested with a reason.`];
    }
    if (measure.kind === 'grade' && !isGrade(entry.value)) {
      return [`Rate ${measure.name} from 0 to ${String(GRADE_MAX)}.`];
    }
    return [];
  });
}

/** What session 4's signing records: the readings as measure rows, and the reasons not tested. */
export function reassessmentRecordings(
  entries: Readonly<Record<string, ReassessmentEntry>>,
  measures: readonly ReassessedMeasure[],
): {
  readings: { key: string; limb: 'involved' | 'uninvolved' | null; value: number; unit: string }[];
  notTested: Record<string, string>;
} {
  const readings: {
    key: string;
    limb: 'involved' | 'uninvolved' | null;
    value: number;
    unit: string;
  }[] = [];
  const notTested: Record<string, string> = {};
  for (const measure of measures) {
    const entry = entries[measure.key];
    if (!entry) continue;
    if (entry.notTested) {
      notTested[measure.key] = entry.reason.trim();
      continue;
    }
    const { key, unit } = measure;
    if (takesBothSides(measure)) {
      if (entry.involved !== null)
        readings.push({ key, limb: 'involved', value: entry.involved, unit });
      if (entry.uninvolved !== null) {
        readings.push({ key, limb: 'uninvolved', value: entry.uninvolved, unit });
      }
    } else if (entry.value !== null) {
      readings.push({ key, limb: null, value: entry.value, unit });
    }
  }
  return { readings, notTested };
}

/** A session 4 entry as the objective's arithmetic reads it. */
export function entryOfReassessment(entry: ReassessmentEntry | undefined): MeasureEntry {
  const read: MeasureEntry = {};
  if (!entry) return read;
  if (entry.involved !== null) read.involved = entry.involved;
  if (entry.uninvolved !== null) read.uninvolved = entry.uninvolved;
  if (entry.value !== null) read.value = entry.value;
  return read;
}

/** "LSI 80% → 92%", "deficit 10 deg → 4 deg", "6/10 → 3/10"; '' without both readings. */
export function reassessmentChangeText(
  measure: KnowledgeMeasure,
  before: MeasureEntry,
  after: MeasureEntry,
): string {
  const was = measureResult(measure, before);
  const now = measureResult(measure, after);
  if (was.lsi !== undefined && now.lsi !== undefined) {
    return `LSI ${lsiPercent(was.lsi)} → ${lsiPercent(now.lsi)}`;
  }
  if (was.deficit !== undefined && now.deficit !== undefined) {
    return `deficit ${measureValueText(measure, was.deficit)} → ${measureValueText(measure, now.deficit)}`;
  }
  if (before.value !== undefined && after.value !== undefined) {
    return `${measureValueText(measure, before.value)} → ${measureValueText(measure, after.value)}`;
  }
  return '';
}

export const REASSESSMENT_DECISION_MAX = 2000;

/** The consultant's signed decision on a reassessment. */
export const reassessmentDecisionSchema = z.object({
  reassessmentId: z.guid(),
  decision: z
    .string()
    .trim()
    .min(1, 'Write the decision.')
    .max(
      REASSESSMENT_DECISION_MAX,
      `Keep the decision to ${REASSESSMENT_DECISION_MAX.toLocaleString('en-IN')} characters.`,
    ),
});
export type ReassessmentDecisionInput = z.infer<typeof reassessmentDecisionSchema>;

/** The consultant's task for a reassessment (OUT-05). */
export const REASSESSMENT_TASK = 'review.reassessment';

/** The reassessment a review task opens; undefined when it cannot be read. */
export function reassessmentIdOf(details: Record<string, unknown>): string | undefined {
  const parsed = z.guid().safeParse(details.reassessmentId);
  return parsed.success ? parsed.data : undefined;
}
