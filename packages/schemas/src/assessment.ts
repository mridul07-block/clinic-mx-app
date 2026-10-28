import { z } from 'zod';
import type { HealthFormAnswer, HealthFormAnswers } from './health-form';
import { conditionIdPattern, type KnowledgeRegion } from './knowledge';
import { subjectiveValue, type SubjectiveFieldKey } from './subjective';

/**
 * The consultation's Assessment (CLN-06, PRD J3.6): the four part working diagnosis of the
 * client's Consultation SOP v2 §10.1 (tissue diagnosis, movement diagnosis, load tolerance and
 * stage) and the client's diagnosis category. The tissue diagnosis is a knowledge base condition;
 * irritability is suggested from the patient's pain and the stage from the duration, both with
 * thresholds read from settings (rule 6). Suggestions are shown, never chosen for the clinician
 * (rule 3: clinicians decide).
 */

/** Load tolerance (SOP v2 §10.1 "Irritable (HIGH) | Moderate | Non-irritable (LOW)"). */
export const irritabilities = ['high', 'moderate', 'low'] as const;
export type Irritability = (typeof irritabilities)[number];
export const irritabilityLabels: Record<Irritability, string> = {
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};
/** SOP v2 §10.2 "Clinical Features", word for word. */
export const irritabilityFeatures: Record<Irritability, string> = {
  high: 'Pain >5/10 at rest or with minimal loading | Night pain | Significant swelling | Antalgic gait',
  moderate:
    'Pain 3–5/10 with moderate activity | Resolves within 24 hours of aggravation | No resting pain',
  low: 'Pain <3/10 with heavy load | No resting pain | Minimal latency | High function',
};

/** Stage (SOP v2 §10.1 "Acute | Subacute | Chronic | Reactive | Degenerative"). */
export const stages = ['acute', 'subacute', 'chronic', 'reactive', 'degenerative'] as const;
export type Stage = (typeof stages)[number];
export const stageLabels: Record<Stage, string> = {
  acute: 'Acute',
  subacute: 'Subacute',
  chronic: 'Chronic',
  reactive: 'Reactive',
  degenerative: 'Degenerative',
};

/** The thresholds suggestions use, from the `assessment.*` settings. */
export interface AssessmentSettings {
  /** Worst pain above this is High. */
  irritabilityHighAbove: number;
  /** Worst pain below this is Low; between the two is Moderate. */
  irritabilityLowBelow: number;
  /** A duration under this many weeks is Acute. */
  acuteWeeksBelow: number;
  /** A duration over this many weeks is Chronic; between the two is Subacute. */
  chronicWeeksAbove: number;
}

const painScore = (answer: HealthFormAnswer | undefined) =>
  typeof answer === 'number' && answer >= 0 && answer <= 10 ? answer : undefined;

export type PainSource = 'pain_now' | 'pain_activity';

export interface IrritabilitySuggestion {
  level: Irritability;
  /** The worse of the two scores, and which one it was. */
  worst: number;
  from: PainSource;
}

/**
 * Irritability from the worse of Pain now and Pain with activity (user decision 24 October 2026,
 * SOP v2 §10.2): above the high threshold High, below the low threshold Low, else Moderate.
 * Undefined when neither score is given.
 */
export function suggestIrritability(
  painNow: HealthFormAnswer | undefined,
  painActivity: HealthFormAnswer | undefined,
  settings: AssessmentSettings,
): IrritabilitySuggestion | undefined {
  const now = painScore(painNow);
  const activity = painScore(painActivity);
  if (now === undefined && activity === undefined) return undefined;
  const from: PainSource =
    activity !== undefined && (now === undefined || activity > now) ? 'pain_activity' : 'pain_now';
  const worst = (from === 'pain_activity' ? activity : now) as number;
  const level: Irritability =
    worst > settings.irritabilityHighAbove
      ? 'high'
      : worst < settings.irritabilityLowBelow
        ? 'low'
        : 'moderate';
  return { level, worst, from };
}

const DAYS_IN_YEAR = 365.25;
const daysPer: Record<string, number> = {
  days: 1,
  weeks: 7,
  months: DAYS_IN_YEAR / 12,
  years: DAYS_IN_YEAR,
};

/** The health form's duration (a number and its unit) in weeks; undefined if either is missing. */
export function durationWeeks(
  duration: HealthFormAnswer | undefined,
  unit: HealthFormAnswer | undefined,
): number | undefined {
  if (typeof duration !== 'number' || duration < 0 || typeof unit !== 'string') return undefined;
  const days = daysPer[unit];
  return days === undefined ? undefined : (duration * days) / 7;
}

/**
 * The stage a duration suggests (SOP v2 §10.1): under the acute threshold Acute, over the chronic
 * threshold Chronic, else Subacute. Reactive and Degenerative are never suggested.
 */
export function suggestStage(
  weeks: number | undefined,
  settings: Pick<AssessmentSettings, 'acuteWeeksBelow' | 'chronicWeeksAbove'>,
): Extract<Stage, 'acute' | 'subacute' | 'chronic'> | undefined {
  if (weeks === undefined) return undefined;
  if (weeks < settings.acuteWeeksBelow) return 'acute';
  if (weeks > settings.chronicWeeksAbove) return 'chronic';
  return 'subacute';
}

export interface AssessmentSuggestions {
  irritability: IrritabilitySuggestion | undefined;
  stage: { stage: Stage; weeks: number } | undefined;
}

/** The suggestions from Subjective's answers: the clinician's where changed, else the patient's. */
export function assessmentSuggestions(
  confirmed: Readonly<Partial<Record<SubjectiveFieldKey, HealthFormAnswer>>>,
  patientAnswers: HealthFormAnswers,
  settings: AssessmentSettings,
): AssessmentSuggestions {
  const value = (key: SubjectiveFieldKey) => subjectiveValue(key, confirmed, patientAnswers);
  const weeks = durationWeeks(value('duration'), value('duration_unit'));
  const stage = suggestStage(weeks, settings);
  return {
    irritability: suggestIrritability(value('pain_now'), value('pain_activity'), settings),
    stage: stage && weeks !== undefined ? { stage, weeks } : undefined,
  };
}

/** "6 weeks", "2 days" or "1.5 years": a duration as the suggestion's reason shows it. */
export function weeksText(weeks: number): string {
  const amount = (n: number, unit: string) => {
    const rounded = Math.round(n * 10) / 10;
    return `${String(rounded)} ${unit}${rounded === 1 ? '' : 's'}`;
  };
  if (weeks < 1) return amount(weeks * 7, 'day');
  if (weeks < 52) return amount(weeks, 'week');
  return amount((weeks * 7) / DAYS_IN_YEAR, 'year');
}

/** A knowledge base condition as the Assessment searches and shows it. */
export interface AssessmentCondition {
  conditionId: string;
  name: string;
  synonyms: string[];
  homeRegion: KnowledgeRegion;
  /** The client's category for it, once mapped (SET-12); null until then. */
  categoryCode: string | null;
  /**
   * Each workbook's row for it: its name there, its "Underlying biomechanical cause" and its
   * "Physiotherapy specific exercise" (the Plan's home programme reference, CLN-07).
   */
  listings: {
    region: KnowledgeRegion;
    name: string;
    biomechanicalCause: string | null;
    specificExercise: string | null;
  }[];
}

export interface DiagnosisCategory {
  code: string;
  name: string;
}

export interface AssessmentCatalog {
  conditions: AssessmentCondition[];
  categories: DiagnosisCategory[];
}

/** The most conditions a search lists. */
export const CONDITION_RESULTS_MAX = 20;

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The conditions whose name, a synonym, a workbook's name for it or its ID holds every word of the
 * query; those listed in the Objective's workbook first, then names starting with the first word,
 * then by name.
 */
export function searchConditions(
  conditions: readonly AssessmentCondition[],
  query: string,
  region: KnowledgeRegion | '',
): AssessmentCondition[] {
  const words = fold(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const first = words[0];
  if (first === undefined) return [];
  const rank = (condition: AssessmentCondition) =>
    (condition.listings.some((listing) => listing.region === region) ? 0 : 2) +
    (fold(condition.name).startsWith(first) ? 0 : 1);
  return conditions
    .filter((condition) => {
      const text = fold(
        [
          condition.name,
          condition.conditionId,
          ...condition.synonyms,
          ...condition.listings.map((listing) => listing.name),
        ].join(' '),
      );
      return words.every((word) => text.includes(word));
    })
    .map((condition) => ({ condition, rank: rank(condition) }))
    .sort((a, b) => a.rank - b.rank || a.condition.name.localeCompare(b.condition.name))
    .slice(0, CONDITION_RESULTS_MAX)
    .map(({ condition }) => condition);
}

/** The longest movement diagnosis. */
export const MOVEMENT_MAX = 200;
export const categoryCodePattern = /^[a-z][a-z0-9_]*$/;

/** What the clinician records in Assessment, beside the notes. */
export const assessmentFields = {
  conditionId: z.union([z.string().regex(conditionIdPattern), z.literal('')]).default(''),
  movement: z
    .string()
    .max(MOVEMENT_MAX, `Keep the movement diagnosis to ${String(MOVEMENT_MAX)} characters.`)
    .default(''),
  irritability: z.union([z.enum(irritabilities), z.literal('')]).default(''),
  stage: z.union([z.enum(stages), z.literal('')]).default(''),
  categoryCode: z.union([z.string().regex(categoryCodePattern).max(80), z.literal('')]).default(''),
  provisional: z.boolean().default(true),
};

export interface AssessmentParts {
  conditionId: string;
  movement: string;
  irritability: string;
  stage: string;
}

/** How many of the four parts are filled in (SOP v2 §10.1: all four make a working diagnosis). */
export function assessmentParts(section: AssessmentParts): number {
  return [
    section.conditionId !== '',
    section.movement.trim() !== '',
    section.irritability !== '',
    section.stage !== '',
  ].filter(Boolean).length;
}

export const ASSESSMENT_PART_COUNT = 4;

/**
 * The committed categories file (`packages/db/src/knowledge/diagnosis-categories.json`): the
 * client's list word for word, each with a stable code, and the conditions mapped to one (SET-12).
 */
export const diagnosisCategoriesFileSchema = z.strictObject({
  source: z.string().min(1),
  categories: z
    .array(
      z.strictObject({
        code: z.string().regex(categoryCodePattern).max(80),
        name: z.string().trim().min(1),
      }),
    )
    .min(1),
  conditions: z.record(
    z.string().regex(conditionIdPattern),
    z.string().regex(categoryCodePattern).max(80),
  ),
});
export type DiagnosisCategoriesFile = z.infer<typeof diagnosisCategoriesFileSchema>;
