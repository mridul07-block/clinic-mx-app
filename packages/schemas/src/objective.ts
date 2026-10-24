import { z } from 'zod';
import type { KnowledgeRegion } from './knowledge';
import type { ScreeningRegion } from './red-flags';

/**
 * The consultation's Objective (CLN-05, PRD J3.4, Frontend Specification "Side by side measure",
 * "Special test row", "Quality rating"). The measures, their units, status rules and the special
 * tests are the workbooks' own (each region's Progress Tracker and Special Tests sheets), imported
 * into the knowledge base; this file holds only the fixed arithmetic the workbooks' formulas do
 * (rule 3: LSI and ratios are deterministic) and the shape of what the clinician records.
 */

/**
 * How a measure is recorded and read (the workbook's section and formula decide it at import):
 * - `lsi`: involved and uninvolved, limb symmetry index = involved / uninvolved (inverted for a
 *   timed test: uninvolved / involved), Pass at the workbook's target;
 * - `deficit`: involved and uninvolved range, deficit = uninvolved - involved (or its size),
 *   banded Symmetrical, Mild deficit or Restricted;
 * - `reference`: one value against the row's normal or target;
 * - `marker`: one value, with which way is better;
 * - `grade`: a 0 to 3 rating, with which way is better.
 */
export const measureKinds = ['lsi', 'deficit', 'reference', 'marker', 'grade'] as const;
export type MeasureKind = (typeof measureKinds)[number];

export type MeasureRule =
  | { kind: 'lsi'; passAt: number; minInvolved?: number }
  | {
      kind: 'deficit';
      absolute: boolean;
      okAt: number;
      mildAt: number;
      okWord: 'symmetrical' | 'full';
    }
  | {
      kind: 'reference_deficit';
      reference: number;
      okAt: number;
      mildAt: number;
      okWord: 'symmetrical' | 'full';
    }
  | { kind: 'reference_target'; reference: number; passWhen: 'at_least' | 'at_most' }
  | { kind: 'none' };

/** A measure as the knowledge base holds it (`kb_measure`). */
export interface KnowledgeMeasure {
  key: string;
  region: KnowledgeRegion;
  section: string;
  name: string;
  unit: string;
  kind: MeasureKind;
  inverted: boolean;
  rule: MeasureRule;
  /** "Higher is better", "Lower is better", as the workbook words it. */
  direction: string | null;
  note: string | null;
}

/** A special test as the knowledge base holds it (`kb_special_test`). */
export interface KnowledgeSpecialTest {
  key: string;
  region: KnowledgeRegion;
  category: string;
  test: string;
  targets: string;
  positiveFinding: string;
  clinicalNote: string;
}

export const measureStatuses = [
  'pass',
  'not_yet',
  'symmetrical',
  'full',
  'mild',
  'restricted',
] as const;
export type MeasureStatus = (typeof measureStatuses)[number];

/** The workbooks' status words, in sentence case. */
export const measureStatusLabels: Record<MeasureStatus, string> = {
  pass: 'Pass',
  not_yet: 'Not yet',
  symmetrical: 'Symmetrical',
  full: 'Full',
  mild: 'Mild deficit',
  restricted: 'Restricted',
};

/** What the clinician entered for one measure. */
export interface MeasureEntry {
  involved?: number;
  uninvolved?: number;
  value?: number;
}

export interface MeasureResult {
  lsi?: number;
  deficit?: number;
  status?: MeasureStatus;
}

const banded = (deficit: number, okAt: number, mildAt: number, okWord: 'symmetrical' | 'full') =>
  deficit <= okAt ? okWord : deficit <= mildAt ? 'mild' : 'restricted';

/**
 * The live result of a measure, as the workbook's formula computes it; empty until the inputs it
 * needs are there (and never a division by zero).
 */
export function measureResult(
  measure: KnowledgeMeasure,
  entry: MeasureEntry | undefined,
): MeasureResult {
  const rule = measure.rule;
  const { involved, uninvolved, value } = entry ?? {};
  switch (rule.kind) {
    case 'lsi': {
      if (involved === undefined || uninvolved === undefined) return {};
      const [top, bottom] = measure.inverted ? [uninvolved, involved] : [involved, uninvolved];
      if (bottom === 0) return {};
      const lsi = top / bottom;
      const pass =
        lsi >= rule.passAt && (rule.minInvolved === undefined || involved >= rule.minInvolved);
      return { lsi, status: pass ? 'pass' : 'not_yet' };
    }
    case 'deficit': {
      if (involved === undefined || uninvolved === undefined) return {};
      const raw = uninvolved - involved;
      const deficit = rule.absolute ? Math.abs(raw) : raw;
      return { deficit, status: banded(deficit, rule.okAt, rule.mildAt, rule.okWord) };
    }
    case 'reference_deficit': {
      if (value === undefined) return {};
      const deficit = rule.reference - value;
      return { deficit, status: banded(deficit, rule.okAt, rule.mildAt, rule.okWord) };
    }
    case 'reference_target': {
      if (value === undefined) return {};
      const pass = rule.passWhen === 'at_least' ? value >= rule.reference : value <= rule.reference;
      return { status: pass ? 'pass' : 'not_yet' };
    }
    case 'none':
      return {};
  }
}

/** Whether a measure takes the involved and uninvolved sides (else one value). */
export const isPaired = (measure: KnowledgeMeasure) =>
  measure.kind === 'lsi' || measure.kind === 'deficit';

/** "80%" for an LSI, as the workbooks show it. */
export const lsiPercent = (lsi: number) => `${String(Math.round(lsi * 100))}%`;

/** The workbook for a screening region (the body region the health form asked about). */
export const knowledgeRegionOfScreening: Record<ScreeningRegion, KnowledgeRegion> = {
  back: 'lumbar_sij',
  neck: 'cervical',
  shoulder: 'shoulder',
  elbow: 'elbow',
  wrist_hand: 'forearm_wrist',
  hip: 'hip',
  knee: 'knee',
  foot_ankle: 'foot_ankle',
};

/** A special test's result (Frontend Specification "Special test row"). */
export const specialTestResults = ['positive', 'negative', 'not_tested'] as const;
export type SpecialTestResult = (typeof specialTestResults)[number];
export const specialTestResultLabels: Record<SpecialTestResult, string> = {
  positive: 'Positive',
  negative: 'Negative',
  not_tested: 'Not tested',
};

export const INTERPRETATION_MAX = 200;
const knowledgeKey = z
  .string()
  .regex(/^[a-z_]+\.[a-z0-9_.]+$/, 'Check this measure.')
  .max(120);
// Zod 4 numbers refuse infinity already.
const reading = z.number().min(-1000).max(100000);

export const measureEntrySchema = z.object({
  involved: reading.optional(),
  uninvolved: reading.optional(),
  value: reading.optional(),
});

export const specialTestEntrySchema = z.object({
  key: knowledgeKey,
  result: z.enum(specialTestResults).optional(),
  interpretation: z
    .string()
    .max(INTERPRETATION_MAX, `Keep the interpretation to ${String(INTERPRETATION_MAX)} characters.`)
    .default(''),
});
export type SpecialTestEntry = z.infer<typeof specialTestEntrySchema>;
