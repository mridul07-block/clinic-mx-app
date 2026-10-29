import { z } from 'zod';

/**
 * The questionnaire library (SET-08; PRD M10 "Questionnaire library with versions, raw answers and
 * automatic scoring", section 6: scoring is a fixed, tested rule; TAD `kb_questionnaire`:
 * "instrument, version, items, scoring rule, meaningful change"; Blueprint Module 8 and section 10:
 * "Calculate scores consistently and handle missing responses and scoring limitations explicitly").
 * An instrument's items, scoring, range, better direction and meaningful change are knowledge base
 * data the clinic supplies with its licence; none is written here. Until an instrument is signed
 * off with a confirmed licence it cannot be filled. Recommended defaults chosen under the user's
 * standing approval, 29 October 2026 (DECISION SET-08; docs/runbooks/questionnaires.md).
 */

/** Whether the clinic may use the instrument: not yet confirmed, free to use, or licensed. */
export const questionnaireLicences = ['unconfirmed', 'free', 'licensed'] as const;
export type QuestionnaireLicence = (typeof questionnaireLicences)[number];

const itemKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(40);
const words = z.string().trim().min(1).max(600);
const label = z.string().trim().min(1).max(120);

const scaleShape = {
  min: z.int().min(0).max(100),
  max: z.int().min(1).max(100),
  minLabel: label,
  maxLabel: label,
};

/**
 * One question: a choice of worded answers, each scoring its value; a scale between two worded
 * ends; or (as the Patient-Specific Functional Scale does) an activity the patient names and rates
 * on a scale.
 */
export const questionnaireItemSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('choice'),
      key: itemKey,
      text: words,
      options: z
        .array(z.strictObject({ label, value: z.number().min(0).max(1000) }))
        .min(2)
        .max(12),
    }),
    z.strictObject({ kind: z.literal('scale'), key: itemKey, text: words, ...scaleShape }),
    z.strictObject({ kind: z.literal('activity'), key: itemKey, text: words, ...scaleShape }),
  ])
  .refine((item) => item.kind === 'choice' || item.min < item.max, {
    error: 'A scale runs from its minimum up to its maximum.',
  })
  .refine(
    (item) =>
      item.kind !== 'choice' ||
      new Set(item.options.map((option) => option.value)).size === item.options.length,
    { error: 'Each answer scores its own value.' },
  );
export type QuestionnaireItem = z.infer<typeof questionnaireItemSchema>;

/**
 * How answers become a score, and how many items may be left unanswered before none is given:
 *  - `sum`: the answers added up; with items missing (no more than `maxMissing`), the sum of those
 *    answered scaled to all items.
 *  - `mean`: the average of the answers given (the Patient-Specific Functional Scale).
 *  - `percent`: the points scored over the points possible on the items answered, as 0 to 100 (the
 *    Oswestry style); `invert` gives 100 less that, for an instrument where higher is better.
 */
export const questionnaireScoringSchema = z
  .strictObject({
    method: z.enum(['sum', 'mean', 'percent']),
    maxMissing: z.int().min(0),
    invert: z.boolean().default(false),
  })
  .refine((scoring) => !scoring.invert || scoring.method === 'percent', {
    error: 'Only a percent score is inverted.',
  });
export type QuestionnaireScoring = z.infer<typeof questionnaireScoringSchema>;

/** An instrument as the clinic supplies it: one version of its items and rules. */
export const questionnaireDefinitionSchema = z
  .strictObject({
    /** The instrument's own version, as printed on it (for example "2.0"). */
    version: z.string().trim().min(1).max(40),
    /** What the patient reads first, word for word; none when the instrument has none. */
    instructions: words.optional(),
    items: z.array(questionnaireItemSchema).min(1).max(100),
    scoring: questionnaireScoringSchema,
    /** The scores possible. */
    range: z.strictObject({ min: z.number(), max: z.number() }),
    better: z.enum(['higher', 'lower']),
    /** The smallest change that matters to the patient; null until the clinic gives it. */
    meaningfulChange: z.number().positive().nullable(),
    /** Where the items, scoring and values come from. */
    source: z.string().trim().min(1),
  })
  .refine((d) => new Set(d.items.map((item) => item.key)).size === d.items.length, {
    error: 'Each item has its own key.',
  })
  .refine((d) => d.scoring.maxMissing < d.items.length, {
    error: 'At least one item must be answered for a score.',
  })
  .refine((d) => d.range.min < d.range.max, { error: 'The range runs from low to high.' })
  // Averaging, or standing the answered items in for missing ones, only means something when
  // every item scores over the same range.
  .refine(
    (d) =>
      !(d.scoring.method === 'mean' || (d.scoring.method === 'sum' && d.scoring.maxMissing > 0)) ||
      sharedRange(d.items) !== null,
    { error: 'Every item scores over the same range for this scoring rule.' },
  )
  .refine((d) => rangeMatches(d), { error: 'The range is what the scoring rule can give.' });
export type QuestionnaireDefinition = z.infer<typeof questionnaireDefinitionSchema>;

/** The range every item shares; null when they differ. */
function sharedRange(items: readonly QuestionnaireItem[]): { min: number; max: number } | null {
  const [first, ...rest] = items.map(itemRange);
  if (!first) return null;
  return rest.every((range) => range.min === first.min && range.max === first.max) ? first : null;
}

/** The lowest and highest score the rule can give: 0 to 100, the items' sums, or their range. */
function rangeMatches(d: {
  items: readonly QuestionnaireItem[];
  scoring: QuestionnaireScoring;
  range: { min: number; max: number };
}): boolean {
  const expected =
    d.scoring.method === 'percent'
      ? { min: 0, max: 100 }
      : d.scoring.method === 'mean'
        ? sharedRange(d.items)
        : d.items
            .map(itemRange)
            .reduce((sum, range) => ({ min: sum.min + range.min, max: sum.max + range.max }), {
              min: 0,
              max: 0,
            });
  return expected !== null && expected.min === d.range.min && expected.max === d.range.max;
}

/** An instrument in the library: its definition (none until supplied), licence and sign-off. */
export interface QuestionnaireEntry {
  definition: QuestionnaireDefinition | null;
  licence: QuestionnaireLicence;
  signedOff: boolean;
}

/** Only a signed off instrument with its items and a confirmed licence is filled by patients. */
export function questionnaireFillable(entry: QuestionnaireEntry): boolean {
  return entry.signedOff && entry.definition !== null && entry.licence !== 'unconfirmed';
}

export const questionnaireStates = [
  'ready',
  'awaiting_items',
  'awaiting_licence',
  'awaiting_sign_off',
] as const;
export type QuestionnaireState = (typeof questionnaireStates)[number];

export const questionnaireStateLabels: Record<QuestionnaireState, string> = {
  ready: 'Ready to fill',
  awaiting_items: 'Awaiting items and scoring',
  awaiting_licence: 'Awaiting licence',
  awaiting_sign_off: 'Awaiting clinical sign-off',
};

/** What an instrument still waits for, the first missing thing first. */
export function questionnaireState(entry: QuestionnaireEntry): QuestionnaireState {
  if (!entry.definition) return 'awaiting_items';
  if (entry.licence === 'unconfirmed') return 'awaiting_licence';
  return entry.signedOff ? 'ready' : 'awaiting_sign_off';
}

/** How many of a library's instruments patients can fill, in a line for the knowledge base. */
export function questionnaireSummary(entries: readonly QuestionnaireEntry[]): string {
  const all = entries.length;
  if (all === 0) return 'This version has no questionnaires.';
  const ready = entries.filter(questionnaireFillable).length;
  const needs = 'needs its items and scoring, a confirmed licence and clinical sign-off';
  if (ready === 0) {
    return all === 1
      ? `The questionnaire cannot be filled yet: it ${needs}.`
      : `None of the ${String(all)} questionnaires can be filled yet: each ${needs}.`;
  }
  return `${String(ready)} of ${String(all)} ${all === 1 ? 'questionnaire' : 'questionnaires'} can be filled by patients.`;
}

/** The lowest and highest an item scores. */
export function itemRange(item: QuestionnaireItem): { min: number; max: number } {
  if (item.kind !== 'choice') return { min: item.min, max: item.max };
  const values = item.options.map((option) => option.value);
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Whether `value` is an answer the item allows. */
export function validAnswer(item: QuestionnaireItem, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (item.kind === 'choice') return item.options.some((option) => option.value === value);
  return Number.isInteger(value) && value >= item.min && value <= item.max;
}

/**
 * One decimal place, half away from zero. Read to 15 significant digits first, so a value that
 * floating point holds as x.x4999… for a true x.x5 still rounds up.
 */
function oneDecimal(value: number): number {
  return (Math.sign(value) * Math.round(Number((Math.abs(value) * 10).toPrecision(15)))) / 10;
}

export type QuestionnaireScore =
  | { status: 'scored'; score: number; answered: number; missing: number }
  | { status: 'not_scored'; reason: 'too_many_missing'; answered: number; missing: number };

/**
 * The score of a set of answers (item key to the value scored), by the instrument's own rule; an
 * answer the item does not allow counts as missing. No score when more items are missing than the
 * rule allows: the result says so rather than guessing.
 */
export function scoreQuestionnaire(
  definition: QuestionnaireDefinition,
  answers: Readonly<Record<string, number | null | undefined>>,
): QuestionnaireScore {
  const given = definition.items.flatMap((item) => {
    const value = answers[item.key];
    return typeof value === 'number' && validAnswer(item, value) ? [{ item, value }] : [];
  });
  const answered = given.length;
  const missing = definition.items.length - answered;
  if (answered === 0 || missing > definition.scoring.maxMissing) {
    return { status: 'not_scored', reason: 'too_many_missing', answered, missing };
  }
  const total = given.reduce((sum, { value }) => sum + value, 0);
  let score: number;
  switch (definition.scoring.method) {
    case 'sum':
      score = (total * definition.items.length) / answered;
      break;
    case 'mean':
      score = total / answered;
      break;
    case 'percent': {
      const low = given.reduce((sum, { item }) => sum + itemRange(item).min, 0);
      const high = given.reduce((sum, { item }) => sum + itemRange(item).max, 0);
      // Multiplied before dividing, so an exact half (23 of 80 is 28.75) stays one.
      score = ((definition.scoring.invert ? high - total : total - low) * 100) / (high - low);
      break;
    }
  }
  return { status: 'scored', score: oneDecimal(score), answered, missing };
}

/** An item's answer as the patient gave it: the value (null when skipped) and an activity's name. */
export interface QuestionnaireRawAnswer {
  value: number | null;
  activity?: string;
}
export type QuestionnaireRawAnswers = Record<string, QuestionnaireRawAnswer>;

/**
 * A filled questionnaire as the patient's phone sends it (OUT-02): the instrument and each item's
 * answer. Checked against the instrument's own items when it is scored.
 */
export const questionnaireSubmissionSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(80),
  /** The knowledge base version and instrument version the patient was shown. */
  kbVersionId: z.guid(),
  version: z.string().min(1).max(40),
  answers: z.record(
    itemKey,
    z.strictObject({
      value: z.number().nullable(),
      activity: z.string().trim().max(120).optional(),
    }),
  ),
});
export type QuestionnaireSubmission = z.infer<typeof questionnaireSubmissionSchema>;

/**
 * The answers to keep for an instrument: every item, its value when the item allows it (else null,
 * so it counts as missing), and for an activity the name the patient gave; nothing else.
 */
export function keptAnswers(
  definition: QuestionnaireDefinition,
  answers: QuestionnaireSubmission['answers'],
): QuestionnaireRawAnswers {
  return Object.fromEntries(
    definition.items.map((item) => {
      const given = answers[item.key];
      const value = given?.value ?? null;
      // An activity is rated only once named; a rating without a name counts as missing.
      const named = item.kind !== 'activity' || Boolean(given?.activity);
      const kept: QuestionnaireRawAnswer = {
        value: named && value !== null && validAnswer(item, value) ? value : null,
      };
      if (item.kind === 'activity' && given?.activity) kept.activity = given.activity;
      return [item.key, kept];
    }),
  );
}

/** The values of kept answers, as `scoreQuestionnaire` takes them. */
export function answerValues(answers: QuestionnaireRawAnswers): Record<string, number | null> {
  return Object.fromEntries(Object.entries(answers).map(([key, answer]) => [key, answer.value]));
}

/**
 * The change from the baseline score to a later one, positive when it is better (by the
 * instrument's direction), and whether it reaches the meaningful change; `met` is null while the
 * instrument has no meaningful change value.
 */
export function changeFromBaseline(
  definition: Pick<QuestionnaireDefinition, 'better' | 'meaningfulChange'>,
  baseline: number,
  latest: number,
): { change: number; met: boolean | null } {
  const change = oneDecimal(definition.better === 'higher' ? latest - baseline : baseline - latest);
  return {
    change,
    met: definition.meaningfulChange === null ? null : change >= definition.meaningfulChange,
  };
}

/** One filled questionnaire as the progress line plots it: its score (null when not scored). */
export interface QuestionnairePoint {
  label: string;
  score: number | null;
}

/** An instrument's line on the Progress tab (OUT-02 with OUT-03, PRD J5.8). */
export interface QuestionnaireLine {
  points: QuestionnairePoint[];
  /** From the baseline to the meaningful change, in the better direction, within the range. */
  band: { from: number; to: number; label: string } | null;
  /** "6 points better than the baseline; the meaningful change is 10, not reached yet." */
  sentence: string | null;
}

const points = (value: number) => `${String(value)} ${Math.abs(value) === 1 ? 'point' : 'points'}`;

/**
 * An instrument's scores in order, its meaningful change band from the first scored one (the
 * baseline), and how the latest compares; labels are the caller's (the dates).
 */
export function questionnaireLine(
  definition: Pick<QuestionnaireDefinition, 'better' | 'meaningfulChange' | 'range'>,
  filled: readonly QuestionnairePoint[],
): QuestionnaireLine {
  const scored = filled.flatMap((point) => (point.score === null ? [] : [point.score]));
  const [baseline] = scored;
  const latest = scored.at(-1);
  const mcid = definition.meaningfulChange;
  const band =
    baseline === undefined || mcid === null
      ? null
      : {
          from: baseline,
          to:
            definition.better === 'higher'
              ? Math.min(definition.range.max, baseline + mcid)
              : Math.max(definition.range.min, baseline - mcid),
          label: 'Meaningful change',
        };
  let sentence: string | null = null;
  if (baseline !== undefined && latest !== undefined && scored.length > 1) {
    const { change, met } = changeFromBaseline(definition, baseline, latest);
    const moved =
      change === 0
        ? 'The same as the baseline'
        : `${points(Math.abs(change))} ${change > 0 ? 'better' : 'worse'} than the baseline`;
    sentence =
      met === null
        ? `${moved}; no meaningful change value yet.`
        : `${moved}; the meaningful change is ${points(mcid ?? 0)}, ${met ? 'reached' : 'not reached yet'}.`;
  }
  // A baseline already at the range's better end leaves no band to draw.
  return { points: [...filled], band: band && band.to !== band.from ? band : null, sentence };
}
