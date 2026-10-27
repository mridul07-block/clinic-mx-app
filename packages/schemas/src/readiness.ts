import { z } from 'zod';
import type { KnowledgeRegion } from './knowledge';
import { measureResult, type KnowledgeMeasure, type MeasureEntry } from './objective';

/**
 * Readiness and clearances (OUT-08, PRD J6.3 to J6.5 and section 7 "Return to sport"; user decisions
 * 27 October 2026). Each region's criteria are its workbook's readiness section, imported as
 * versioned knowledge (`kb_readiness_criterion`): every measure a count line points at is a
 * criterion judged by the workbook's rule from the episode's newest reading; every yes or no line
 * is one the consultant marks. A criterion is Met, Not met or Not assessed; a consultant may
 * override one that is not Met with a written reason. The three statuses are signed in order, each
 * only while every criterion is Met or overridden (DECISION, same criteria for all three).
 */

/**
 * How a criterion is judged:
 * - `measure`: the measure's own rule (an LSI passes; a deficit is symmetrical, full or mild; a
 *   target is reached);
 * - `target`: the newest reading reaches the workbook's target (functional tolerance);
 * - `mcid`: the change from the episode's first reading reaches the workbook's MCID;
 * - `yes`: a yes or no line, Met when the consultant says so;
 * - `none_positive`: a count of positive screen items, Met when none is positive.
 */
export type ReadinessRule =
  | { kind: 'measure' }
  | { kind: 'target'; target: number }
  | { kind: 'mcid'; mcid: number; better: 'lower' | 'higher' }
  | { kind: 'yes' }
  | { kind: 'none_positive' };

export const readinessCriterionKinds = ['measure', 'check'] as const;
export type ReadinessCriterionKind = (typeof readinessCriterionKinds)[number];

/** A criterion as the knowledge base holds it (`kb_readiness_criterion`). */
export interface ReadinessCriterion {
  /** The measure's key for a measured criterion; `<region>.readiness.<slug>` for a check. */
  key: string;
  region: KnowledgeRegion;
  kind: ReadinessCriterionKind;
  measureKey: string | null;
  /** Word for word: the measure's name, or the workbook's line. */
  text: string;
  /** The workbook section it sits in. */
  section: string;
  rule: ReadinessRule;
  /** Only the workbook's overall verdict names it, not a line of the readiness section. */
  fromVerdict: boolean;
}

export const criterionResults = ['met', 'not_met', 'not_assessed'] as const;
export type CriterionResult = (typeof criterionResults)[number];

export const criterionResultLabels: Record<CriterionResult, string> = {
  met: 'Met',
  not_met: 'Not met',
  not_assessed: 'Not assessed',
};

const metStatuses = new Set(['pass', 'symmetrical', 'full', 'mild']);

/**
 * A measured criterion's result from the episode's readings: `latest` is the newest reading,
 * `first` the episode's first (an MCID needs both, taken apart). Not assessed without them.
 */
export function measuredResult(
  criterion: Pick<ReadinessCriterion, 'rule'>,
  measure: KnowledgeMeasure,
  latest: MeasureEntry | undefined,
  first: MeasureEntry | undefined,
): CriterionResult {
  const { rule } = criterion;
  switch (rule.kind) {
    case 'measure': {
      const { status } = measureResult(measure, latest);
      if (!status) return 'not_assessed';
      return metStatuses.has(status) ? 'met' : 'not_met';
    }
    case 'target': {
      if (latest?.value === undefined) return 'not_assessed';
      return latest.value >= rule.target ? 'met' : 'not_met';
    }
    case 'mcid': {
      if (latest?.value === undefined || first?.value === undefined || first === latest) {
        return 'not_assessed';
      }
      const change =
        rule.better === 'lower' ? first.value - latest.value : latest.value - first.value;
      return change >= rule.mcid ? 'met' : 'not_met';
    }
    case 'yes':
    case 'none_positive':
      return 'not_assessed';
  }
}

/** The three clearances, signed in this order (PRD J6.4). */
export const clearanceStatuses = [
  'rehabilitation_complete',
  'return_to_training',
  'return_to_sport',
] as const;
export type ClearanceStatus = (typeof clearanceStatuses)[number];

export const clearanceStatusLabels: Record<ClearanceStatus, string> = {
  rehabilitation_complete: 'Rehabilitation complete',
  return_to_training: 'Return to training',
  return_to_sport: 'Return to sport',
};

/** A criterion as it stands on the panel: its result and any override's reason. */
export interface CriterionState {
  result: CriterionResult;
  override: string | null;
}

const tests = (count: number) => (count === 1 ? '1 test' : `${String(count)} tests`);

/**
 * What keeps a clearance from being signed, in the Frontend Specification's words ("2 tests not
 * assessed. Record them or add an override reason."); empty when every criterion is Met or
 * overridden.
 */
export function clearanceBlockers(states: readonly CriterionState[]): string[] {
  const open = states.filter((state) => state.result !== 'met' && !state.override);
  const notAssessed = open.filter((state) => state.result === 'not_assessed').length;
  const notMet = open.filter((state) => state.result === 'not_met').length;
  const blockers: string[] = [];
  if (notAssessed > 0) {
    blockers.push(
      `${tests(notAssessed)} not assessed. Record ${notAssessed === 1 ? 'it' : 'them'} or add an override reason.`,
    );
  }
  if (notMet > 0) blockers.push(`${tests(notMet)} not met. Add an override reason.`);
  return blockers;
}

/** Why a status cannot be signed yet: the one before it, then the criteria. */
export function clearanceRefusal(
  status: ClearanceStatus,
  signed: readonly ClearanceStatus[],
  states: readonly CriterionState[],
): string | undefined {
  if (signed.includes(status)) return `${clearanceStatusLabels[status]} is signed already.`;
  const before = clearanceStatuses[clearanceStatuses.indexOf(status) - 1];
  if (before && !signed.includes(before)) {
    return `Sign ${clearanceStatusLabels[before]} first.`;
  }
  return clearanceBlockers(states)[0];
}

export const OVERRIDE_REASON_MAX = 1000;

const criterionKey = z
  .string()
  .regex(/^[a-z_]+\.[a-z0-9_.]+$/)
  .max(160);

/** A consultant's mark on a yes or no criterion. */
export const readinessCheckSchema = z.object({
  episodeId: z.guid(),
  criterionKey,
  result: z.enum(criterionResults),
});
export type ReadinessCheckInput = z.infer<typeof readinessCheckSchema>;

/** A consultant's override of a criterion that is not Met, with the written reason. */
export const readinessOverrideSchema = z.object({
  episodeId: z.guid(),
  criterionKey,
  reason: z
    .string()
    .trim()
    .min(1, 'Write the reason for the override.')
    .max(
      OVERRIDE_REASON_MAX,
      `Keep the reason to ${OVERRIDE_REASON_MAX.toLocaleString('en-IN')} characters.`,
    ),
});
export type ReadinessOverrideInput = z.infer<typeof readinessOverrideSchema>;

const reading = z.number().min(-1000).max(100000).nullable().default(null);

/** A reading taken on the panel for a measured criterion never measured in the episode. */
export const readinessReadingSchema = z.object({
  episodeId: z.guid(),
  criterionKey,
  involved: reading,
  uninvolved: reading,
  value: reading,
});
export type ReadinessReadingInput = z.infer<typeof readinessReadingSchema>;

/** Signing one of the three clearances. */
export const clearanceSignSchema = z.object({
  episodeId: z.guid(),
  status: z.enum(clearanceStatuses),
});
export type ClearanceSignInput = z.infer<typeof clearanceSignSchema>;

/** One criterion as a signed clearance keeps it. */
export interface ClearanceCriterion {
  key: string;
  text: string;
  result: CriterionResult;
  reading: string | null;
  override: string | null;
}
