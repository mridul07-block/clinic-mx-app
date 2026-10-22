import type { KnowledgeRegion } from '@clinic-mx/schemas';

/**
 * The workbooks name their Master Matrix columns differently (Knee says "Provisional Diagnosis"
 * where the others say "Condition"; each names its adjunct column for its region; Bone Stress has
 * its own layout). Each header maps to one canonical key; a header not listed here stops the
 * import, so a new or renamed column is never silently dropped.
 */
export const columnKeys = [
  'name',
  'subregion',
  'activity',
  'symptoms',
  'age',
  'onset',
  'sex',
  'question',
  'tests_imaging',
  'biomechanical_cause',
  'red_flag',
  'risk_class',
  'source',
  'activity_goal',
  'specific_exercise',
  'pain_mechanism',
  'classification',
  'management_emphasis',
  'loading_stage',
  'corrections',
  'adjuncts',
  'advanced_options',
  'outcome_measures',
  'retest_markers',
  'timeline',
  'referral_trigger',
  'evidence_anchor',
  'athlete_profile',
  'examination_findings',
  'non_mechanical_contributors',
  'weight_bearing',
  'training_load',
  'consequence_if_missed',
] as const;

export type ColumnKey = (typeof columnKeys)[number];

/** Keys stored in their own columns; every other key goes to `details`. */
export const typedKeys = new Set<ColumnKey>([
  'name',
  'subregion',
  'activity',
  'symptoms',
  'age',
  'onset',
  'sex',
  'question',
  'tests_imaging',
  'biomechanical_cause',
  'red_flag',
  'risk_class',
]);

const headers: Record<string, ColumnKey> = {
  condition: 'name',
  'provisional diagnosis': 'name',
  'site / condition': 'name',
  region: 'subregion',
  'region / site of pain': 'subregion',
  tissue: 'subregion',
  'activity level': 'activity',
  'typical activity level': 'activity',
  'sport & load pattern': 'activity',
  'common symptoms': 'symptoms',
  'signs & symptoms': 'symptoms',
  'hallmark presentation': 'symptoms',
  'age group': 'age',
  'age (yrs)': 'age',
  onset: 'onset',
  predominance: 'sex',
  'sex predominance': 'sex',
  'high-yield diagnostic question': 'question',
  'one question that best discriminates': 'question',
  'special test + imaging': 'tests_imaging',
  'confirmatory test / imaging': 'tests_imaging',
  'confirmatory imaging': 'tests_imaging',
  'underlying biomechanical cause': 'biomechanical_cause',
  'load & biomechanical driver': 'biomechanical_cause',
  'red flag status': 'red_flag',
  'risk class': 'risk_class',
  source: 'source',
  'desired activity goal': 'activity_goal',
  'physiotherapy specific exercise': 'specific_exercise',
  'pain mechanism': 'pain_mechanism',
  'classification / cluster': 'classification',
  'diagnostic cluster / classification': 'classification',
  'grading / classification': 'classification',
  'management emphasis': 'management_emphasis',
  'loading stage & entry dose': 'loading_stage',
  'loading progression & dose': 'loading_stage',
  'biomechanical corrections & kinetic chain': 'corrections',
  'biomechanical corrections & regional interdependence': 'corrections',
  'biomechanical & technique corrections': 'corrections',
  'manual therapy, taping & adjuncts': 'adjuncts',
  'manual therapy, bracing & adjuncts': 'adjuncts',
  'splinting, ergonomics & adjuncts': 'adjuncts',
  'manual therapy, positional & adjuncts': 'adjuncts',
  'manual therapy, taping, bracing & orthoses': 'adjuncts',
  'footwear, orthoses & adjuncts': 'adjuncts',
  'manual therapy, ergonomics & adjuncts': 'adjuncts',
  'adjuncts & practical measures': 'adjuncts',
  'advanced / surgical options': 'advanced_options',
  'advanced / adjunct options (if stalled 8-12 wks)': 'advanced_options',
  'adjuncts / advanced options': 'advanced_options',
  'outcome measures': 'outcome_measures',
  're-testable markers': 'retest_markers',
  're-test markers & outcomes': 'retest_markers',
  'expected timeline': 'timeline',
  'timeline to return to sport': 'timeline',
  'referral / surgical trigger': 'referral_trigger',
  'evidence anchor': 'evidence_anchor',
  'athlete profile': 'athlete_profile',
  'key examination findings': 'examination_findings',
  'non-mechanical contributors': 'non_mechanical_contributors',
  'weight-bearing / protection status': 'weight_bearing',
  'training-load prescription': 'training_load',
  'consequence if missed': 'consequence_if_missed',
};

/** Columns every workbook must have; Bone Stress has a Risk Class where the others state red flags. */
const required = (region: KnowledgeRegion): ColumnKey[] =>
  region === 'bone_stress'
    ? ['name', 'subregion', 'activity', 'symptoms', 'question', 'tests_imaging', 'risk_class']
    : [
        'name',
        'subregion',
        'activity',
        'symptoms',
        'age',
        'onset',
        'sex',
        'question',
        'tests_imaging',
        'red_flag',
      ];

export interface ColumnMap {
  /** Header position to key; one key per position. */
  keys: ColumnKey[];
  /** Headers as the workbook writes them, by position. */
  labels: string[];
}

/** Maps a workbook's header row, or throws naming every header it cannot place. */
export function mapColumns(region: KnowledgeRegion, header: string[]): ColumnMap {
  const problems: string[] = [];
  const keys = header.map((label) => {
    const key = headers[label.toLowerCase()];
    if (!key) problems.push(`unknown column "${label}"`);
    return key as ColumnKey;
  });
  for (const key of new Set(keys)) {
    if (keys.filter((k) => k === key).length > 1) problems.push(`two columns read as "${key}"`);
  }
  for (const key of required(region)) {
    if (!keys.includes(key)) problems.push(`no column for "${key}"`);
  }
  if (problems.length > 0) throw new ColumnError(region, problems);
  return { keys, labels: header };
}

export class ColumnError extends Error {
  override name = 'ColumnError';
  constructor(
    readonly region: KnowledgeRegion,
    readonly problems: string[],
  ) {
    super(`The ${region} workbook's Master Matrix: ${problems.join('; ')}.`);
  }
}
