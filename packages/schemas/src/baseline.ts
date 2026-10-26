import { z } from 'zod';
import { consultationScreening, type ConsultationSections } from './consultations';
import type { HealthFormAnswers } from './health-form';
import type { KnowledgeRegion } from './knowledge';
import {
  isPaired,
  knowledgeRegionOfScreening,
  lsiPercent,
  measureResult,
  measureStatusLabels,
  type KnowledgeMeasure,
  type MeasureEntry,
  type MeasureResult,
} from './objective';

/**
 * The episode's baseline (OUT-01, PRD J5.3 and section 7 "Baseline reuse"; user decisions 26
 * October 2026). Session 1 records it: every measure the consultation took within
 * `clinical.baseline_reuse_days` before session 1 started is reused, and each of the region's
 * re-testable markers (the workbook's "Baseline | Current" rows) without one is asked for, to be
 * recorded or marked Not tested with a reason before the session closes. Signing freezes it, so
 * final testing (OUT-07) lists exactly these. Questionnaires join it with OUT-02.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const BASELINE_REASON_MAX = 200;
/** The highest 0 to 3 quality rating. */
const GRADE_MAX = 3;

/** The region the consultation measured: the Objective's, or else the screening region. */
export function consultationRegion(
  sections: ConsultationSections,
  answers: HealthFormAnswers,
): KnowledgeRegion | '' {
  if (sections.objective.region) return sections.objective.region;
  const { region } = consultationScreening(sections, answers);
  return region ? knowledgeRegionOfScreening[region] : '';
}

/** A re-testable marker: one of the workbook's "Baseline | Current" rows. */
export const isBaselineMarker = (measure: KnowledgeMeasure) =>
  measure.kind === 'marker' || measure.kind === 'grade';

/** The region's re-testable markers, in the workbook's order. */
export function baselineMarkers(
  catalog: readonly KnowledgeMeasure[],
  region: KnowledgeRegion | '',
): KnowledgeMeasure[] {
  return region === ''
    ? []
    : catalog.filter((measure) => measure.region === region && isBaselineMarker(measure));
}

/** One consultation measure row (TAD `measure`). */
export interface TakenMeasure {
  key: string;
  limb: 'involved' | 'uninvolved' | null;
  value: number;
  takenAt: Date;
  consultationId: string;
}

export interface ReusedMeasure {
  measure: KnowledgeMeasure;
  entry: MeasureEntry;
  result: MeasureResult;
  takenAt: Date;
  consultationId: string;
}

export interface EpisodeBaseline {
  reused: ReusedMeasure[];
  missing: KnowledgeMeasure[];
}

/** The earliest a consultation measure may be taken and still count for a session started then. */
export const baselineWindowStart = (startedAt: Date, reuseDays: number) =>
  new Date(startedAt.getTime() - reuseDays * DAY_MS);

/**
 * The baseline at session 1: the newest consultation's reading of each measure taken in the
 * window, in the catalog's order, and the region's markers left without one. A measure the
 * catalog no longer holds is left out.
 */
export function episodeBaseline(input: {
  catalog: readonly KnowledgeMeasure[];
  region: KnowledgeRegion | '';
  taken: readonly TakenMeasure[];
  startedAt: Date;
  reuseDays: number;
}): EpisodeBaseline {
  const from = baselineWindowStart(input.startedAt, input.reuseDays).getTime();
  const counted = input.taken.filter(
    (row) => row.takenAt.getTime() >= from && row.takenAt.getTime() <= input.startedAt.getTime(),
  );
  const reused = input.catalog.flatMap((measure): ReusedMeasure[] => {
    const rows = counted.filter((row) => row.key === measure.key);
    const newest = rows.reduce<TakenMeasure | undefined>(
      (best, row) => (!best || row.takenAt > best.takenAt ? row : best),
      undefined,
    );
    if (!newest) return [];
    const entry = entryOfReadings(rows.filter((r) => r.consultationId === newest.consultationId));
    return [
      {
        measure,
        entry,
        result: measureResult(measure, entry),
        takenAt: newest.takenAt,
        consultationId: newest.consultationId,
      },
    ];
  });
  const missing = baselineMarkers(input.catalog, input.region).filter(
    (marker) => !reused.some((r) => r.measure.key === marker.key),
  );
  return { reused, missing };
}

/** "6/10", "2", "120 deg". */
export function measureValueText(measure: KnowledgeMeasure, value: number): string {
  if (measure.kind === 'grade') return String(value);
  return measure.unit.startsWith('/')
    ? `${String(value)}${measure.unit}`
    : `${String(value)} ${measure.unit}`;
}

/** A measure's readings as one entry: a single value, or the involved and uninvolved sides. */
export function entryOfReadings(
  readings: readonly { limb: 'involved' | 'uninvolved' | null; value: number }[],
): MeasureEntry {
  const entry: MeasureEntry = {};
  for (const reading of readings) {
    if (reading.limb === null) entry.value = reading.value;
    else entry[reading.limb] = reading.value;
  }
  return entry;
}

/** "Involved 32 kg, uninvolved 40 kg · LSI 80% · Not yet", or "6/10". */
export function baselineReadingText(measure: KnowledgeMeasure, entry: MeasureEntry): string {
  const sides: string[] = [];
  if (isPaired(measure)) {
    if (entry.involved !== undefined) {
      sides.push(`Involved ${measureValueText(measure, entry.involved)}`);
    }
    if (entry.uninvolved !== undefined) {
      sides.push(`uninvolved ${measureValueText(measure, entry.uninvolved)}`);
    }
  } else if (entry.value !== undefined) {
    sides.push(measureValueText(measure, entry.value));
  }
  const result = measureResult(measure, entry);
  return [
    sides.join(', '),
    result.lsi === undefined ? '' : `LSI ${lsiPercent(result.lsi)}`,
    result.deficit === undefined ? '' : `deficit ${measureValueText(measure, result.deficit)}`,
    result.status ? measureStatusLabels[result.status] : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

/** A session 1 entry for a missing marker: its value, or Not tested with a reason. */
export const baselineEntrySchema = z.object({
  value: z.number().min(-1000).max(100000).nullable().default(null),
  notTested: z.boolean().default(false),
  reason: z
    .string()
    .max(BASELINE_REASON_MAX, `Keep the reason to ${String(BASELINE_REASON_MAX)} characters.`)
    .default(''),
});
export type BaselineEntry = z.infer<typeof baselineEntrySchema>;

const isGrade = (value: number) => Number.isInteger(value) && value >= 0 && value <= GRADE_MAX;

/** What session 1 needs to know of a marker it asks for. */
export type BaselineMarker = Pick<KnowledgeMeasure, 'key' | 'name' | 'kind' | 'unit'>;

/** What still holds session 1 back on its baseline, in the markers' order. */
export function baselineBlockers(
  entries: Readonly<Record<string, BaselineEntry>>,
  missing: readonly BaselineMarker[],
): string[] {
  return missing.flatMap((marker) => {
    const entry = entries[marker.key];
    if (entry?.notTested) {
      return entry.reason.trim() === '' ? [`Give the reason ${marker.name} was not tested.`] : [];
    }
    if (entry?.value === undefined || entry.value === null) {
      return [`Record ${marker.name}, or mark it Not tested with a reason.`];
    }
    if (marker.kind === 'grade' && !isGrade(entry.value)) {
      return [`Rate ${marker.name} from 0 to ${String(GRADE_MAX)}.`];
    }
    return [];
  });
}

/** What session 1's signing writes for each missing marker: a value, or the reason it was not. */
export type BaselineRecording =
  { key: string; value: number; unit: string } | { key: string; notTestedReason: string };

/** The recordings of a baseline with no blockers left. */
export function baselineRecordings(
  entries: Readonly<Record<string, BaselineEntry>>,
  missing: readonly BaselineMarker[],
): BaselineRecording[] {
  return missing.flatMap((marker): BaselineRecording[] => {
    const entry = entries[marker.key];
    if (!entry) return [];
    if (entry.notTested) return [{ key: marker.key, notTestedReason: entry.reason.trim() }];
    return entry.value === null ? [] : [{ key: marker.key, value: entry.value, unit: marker.unit }];
  });
}
