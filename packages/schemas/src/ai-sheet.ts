import { z } from 'zod';
import { aiCaseSchema, aiRunStatuses, type AiCase } from './ai-gateway';
import { bodyChartZoneByKey } from './body-chart';
import type { CandidateCase, ShortlistItem } from './candidates';
import type { HealthFormAnswers } from './health-form';
import { knowledgeRegions } from './knowledge';
import { subjectiveField } from './subjective';

/**
 * The AI preparation sheet (AI-03; PRD section 6 "How the preparation sheet works" steps 3 to 6;
 * TAD section 7 steps 5 to 7; Frontend Specification "Preparation sheet" and "AI suggestion
 * card"). The model ranks the shortlist (AI-02) and code validates: unknown or repeated rows are
 * dropped and the count is kept (decision 3); must rule out comes from the shortlist by rule,
 * whatever the model says. Every clinical word on the sheet is the knowledge base's own.
 * Recommended defaults chosen under the user's standing approval, 28 October 2026 (DECISION AI-03
 * in docs/PROGRESS.md; docs/runbooks/ai-preparation-sheet.md).
 */

export const aiSheetStatuses = ['pending', 'ready', 'unavailable'] as const;
export type AiSheetStatus = (typeof aiSheetStatuses)[number];

export const aiSuggestionSections = ['top', 'also_consider'] as const;
export type AiSuggestionSection = (typeof aiSuggestionSections)[number];

export const aiDispositions = ['kept', 'dismissed'] as const;
export type AiDisposition = (typeof aiDispositions)[number];

export const aiDispositionLabels: Record<AiDisposition, string> = {
  kept: 'Kept',
  dismissed: 'Dismissed',
};

/** Why a sheet holds no suggestions: the gateway's reason, or one of the sheet's own. */
export const aiSheetUnavailableReasons = [
  ...aiRunStatuses.filter((status) => status !== 'ok'),
  'no_region',
  'no_form',
  'no_valid_suggestions',
] as const;
export type AiSheetUnavailableReason = (typeof aiSheetUnavailableReasons)[number];

/** The microcopy for a sheet without suggestions (Frontend Specification, "AI unavailable"). */
export const SUGGESTIONS_UNAVAILABLE =
  'Suggestions unavailable right now. Continue the consultation as usual.';

/** A suggestion as validated: the shortlist row the model ranked, its place and reason. */
export interface ValidatedSuggestion {
  conditionId: string;
  region: ShortlistItem['region'];
  rowNumber: number;
  rank: number;
  section: AiSuggestionSection;
  reason: string;
}

/**
 * Validates the model's ranking against the shortlist sent (rows were numbered 1 to N in the
 * shortlist's order): a number not on the list is dropped, a condition ranked twice keeps its
 * first place, and only the first `top` plus `alsoConsider` stay, ranked from 1. Fewer valid rows
 * give fewer suggestions; none are added that the model did not rank.
 */
export function validateRanking(
  items: readonly ShortlistItem[],
  ranked: readonly { n: number; reason: string }[],
  counts: { top: number; alsoConsider: number },
): ValidatedSuggestion[] {
  const seen = new Set<string>();
  const valid: { item: ShortlistItem; reason: string }[] = [];
  for (const { n, reason } of ranked) {
    const item = Number.isInteger(n) ? items[n - 1] : undefined;
    if (!item || seen.has(item.conditionId)) continue;
    seen.add(item.conditionId);
    valid.push({ item, reason });
  }
  return valid.slice(0, counts.top + counts.alsoConsider).map(({ item, reason }, index) => ({
    conditionId: item.conditionId,
    region: item.region,
    rowNumber: item.rowNumber,
    rank: index + 1,
    section: index < counts.top ? 'top' : 'also_consider',
    reason,
  }));
}

const MAX_TEXT = 200;
const MAX_ENTRIES = 20;
const clip = (text: string) => text.trim().slice(0, MAX_TEXT);
const texts = (...values: unknown[]) =>
  values
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map(clip);

/** The body chart zones marked, by their labels (unknown keys left out). */
export function zoneLabels(keys: readonly string[]): string[] {
  return keys
    .flatMap((key) => {
      const zone = bodyChartZoneByKey.get(key);
      return zone ? [zone.label] : [];
    })
    .slice(0, MAX_ENTRIES);
}

/** The activities ticked, by their labels: never "Other" or "Not active". */
export function activityLabels(values: unknown): string[] {
  return optionLabels('activities', values).slice(0, MAX_ENTRIES);
}

function optionLabels(key: 'activities', values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const field = subjectiveField(key);
  const options = field.kind === 'multi_choice' ? field.options : [];
  return values.flatMap((value) => {
    const option = options.find((o) => o.value === value);
    return option && value !== 'other' && value !== 'not_active' ? [option.label] : [];
  });
}

/**
 * The case the model is sent (TAD section 7: "only age, sex, region, symptoms, duration, sport and
 * goal"), from the shortlist's case and the health form: symptoms are the marked pain zones, the
 * main complaint, how it started and what aggravates and eases it; sport is the activities; goal
 * is the patient's goals. Each text is cut to 200 characters. Null without a region.
 */
export function aiCaseFrom(c: CandidateCase, answers: HealthFormAnswers): AiCase | null {
  if (!c.region) return null;
  const symptoms = [
    ...zoneLabels(c.painZones),
    ...texts(answers.complaint, answers.how_started, answers.aggravating, answers.easing),
  ].slice(0, MAX_ENTRIES);
  const sport = [
    ...optionLabels('activities', answers.activities),
    ...texts(answers.activity_other),
  ].slice(0, MAX_ENTRIES);
  // An age or duration past what the case allows (a mistyped year) is sent as unknown.
  const age = c.age !== null && c.age >= 0 && c.age <= 120 ? c.age : null;
  const weeks = c.durationWeeks !== null && c.durationWeeks <= 5200 ? c.durationWeeks : null;
  return aiCaseSchema.parse({
    age,
    sex: c.sex,
    region: c.region,
    symptoms,
    durationWeeks: weeks === null ? null : Math.round(weeks * 10) / 10,
    sport,
    goal: texts(answers.goals)[0] ?? null,
  });
}

/** A physio keeping or dismissing one suggestion. */
export const aiDispositionSchema = z.strictObject({
  suggestionId: z.guid({ error: 'That suggestion was not found.' }),
  disposition: z.enum(aiDispositions, { error: 'Choose Keep or Dismiss.' }),
});

/** The source line of a knowledge base row (Frontend Specification: "source link"). */
export function knowledgeSource(
  row: { conditionId: string; region: ShortlistItem['region']; rowNumber: number },
  kbVersionNumber: number,
): string {
  return `Knowledge base version ${String(kbVersionNumber)} · ${knowledgeRegions[row.region].label} row ${String(row.rowNumber)} · ${row.conditionId}`;
}

/** A duration for people: days under a week, else whole weeks. */
export function durationLabel(weeks: number): string {
  if (weeks < 1) {
    const days = Math.max(1, Math.round(weeks * 7));
    return `${String(days)} ${days === 1 ? 'day' : 'days'}`;
  }
  const whole = Math.round(weeks);
  return `${String(whole)} ${whole === 1 ? 'week' : 'weeks'}`;
}
