import {
  screeningQuestionKeys,
  screeningQuestions,
  screeningRegionLabels,
  screeningRegions,
  type ScreeningQuestion,
} from './red-flags';

/**
 * The health form engine (INT-04, PRD J2.3, Frontend Specification §7): a form is versioned data,
 * screens and fields that show on earlier answers, and a patient's answers keep the version they
 * were given, so a published version never changes (rule 4). Pure: the page renders a screen,
 * `parseScreen` reads what was posted, `pruneAnswers` drops answers a change has hidden, and
 * `resumeAt` says where a returning patient carries on.
 */

/** An answer as stored: yes or no, a number, a choice, several choices, or text. */
export type HealthFormAnswer = boolean | number | string | readonly string[];
export type HealthFormAnswers = Readonly<Record<string, HealthFormAnswer>>;

/** A screen or field shows only when an earlier answer is this value, or one of these. */
export type HealthFormCondition =
  { answer: string; is: boolean | number | string } | { answer: string; in: readonly string[] };

interface FieldBase {
  key: string;
  /** As the patient reads it. */
  label: string;
  /** Where the wording comes from. */
  source: string;
  showIf?: readonly HealthFormCondition[];
}

export interface HealthFormOption {
  value: string;
  label: string;
}

export type HealthFormField =
  | (FieldBase & { kind: 'yes_no' })
  | (FieldBase & { kind: 'number'; unit: string; max: number })
  | (FieldBase & { kind: 'single_choice'; options: readonly HealthFormOption[] })
  | (FieldBase & { kind: 'multi_choice'; options: readonly HealthFormOption[] })
  | (FieldBase & { kind: 'text'; maxLength: number });

export interface HealthFormScreen {
  /** Stable, in addresses and the record; never `end`. */
  key: string;
  title: string;
  source: string;
  fields: readonly HealthFormField[];
  showIf?: readonly HealthFormCondition[];
  /** Patient wording not yet approved by the client (INT-05 brings the approval). */
  awaitingApproval: boolean;
}

export interface HealthFormDefinition {
  version: string;
  screens: readonly HealthFormScreen[];
}

/** After the last screen. */
export const HEALTH_FORM_END = 'end';

function holds(condition: HealthFormCondition, answers: HealthFormAnswers): boolean {
  const answer = answers[condition.answer];
  if ('is' in condition) return answer === condition.is;
  return typeof answer === 'string' && condition.in.includes(answer);
}

const allHold = (
  conditions: readonly HealthFormCondition[] | undefined,
  answers: HealthFormAnswers,
) => (conditions ?? []).every((condition) => holds(condition, answers));

export function visibleScreens(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
): HealthFormScreen[] {
  return form.screens.filter((screen) => allHold(screen.showIf, answers));
}

export function visibleFields(
  screen: HealthFormScreen,
  answers: HealthFormAnswers,
): HealthFormField[] {
  return screen.fields.filter((field) => allHold(field.showIf, answers));
}

/**
 * Keeps only the answers to fields still shown, in form order (conditions name earlier fields):
 * changing the region from back to knee drops the back questions' answers.
 */
export function pruneAnswers(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
): Record<string, HealthFormAnswer> {
  const kept: Record<string, HealthFormAnswer> = {};
  for (const screen of form.screens) {
    if (!allHold(screen.showIf, kept)) continue;
    for (const field of screen.fields) {
      const answer = answers[field.key];
      if (answer !== undefined && allHold(field.showIf, kept)) kept[field.key] = answer;
    }
  }
  return kept;
}

/** A shown screen is complete once it was sent and every field it shows has an answer. */
function complete(
  screen: HealthFormScreen,
  answers: HealthFormAnswers,
  done: readonly string[],
): boolean {
  return (
    done.includes(screen.key) &&
    visibleFields(screen, answers).every((field) => answers[field.key] !== undefined)
  );
}

/** Where a returning patient carries on: the first shown screen not complete, or the end. */
export function resumeAt(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
  done: readonly string[],
): string {
  return (
    visibleScreens(form, answers).find((screen) => !complete(screen, answers, done))?.key ??
    HEALTH_FORM_END
  );
}

/** A screen may open once every shown screen before it is complete; the end once all are. */
export function canOpen(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
  done: readonly string[],
  key: string,
): boolean {
  const screens = visibleScreens(form, answers);
  const at = key === HEALTH_FORM_END ? screens.length : screens.findIndex((s) => s.key === key);
  return at >= 0 && screens.slice(0, at).every((screen) => complete(screen, answers, done));
}

/** The shown screen after `key`, or the end. */
export function nextScreen(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
  key: string,
): string {
  const screens = visibleScreens(form, answers);
  return screens[screens.findIndex((s) => s.key === key) + 1]?.key ?? HEALTH_FORM_END;
}

/** The shown screen before `key` (the last one before the end), if any. */
export function previousScreen(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
  key: string,
): string | undefined {
  const screens = visibleScreens(form, answers);
  const at = key === HEALTH_FORM_END ? screens.length : screens.findIndex((s) => s.key === key);
  return at > 0 ? screens[at - 1]?.key : undefined;
}

/** "Step n of m" over the screens shown. */
export function stepOf(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
  key: string,
): { step: number; of: number } {
  const screens = visibleScreens(form, answers);
  return { step: screens.findIndex((s) => s.key === key) + 1, of: screens.length };
}

/** A question on a screen and the follow ups a yes to it shows. */
export interface HealthFormRow {
  field: HealthFormField;
  followUps: HealthFormField[];
}

/**
 * A screen as the page lays it out, working without scripts: the questions shown on earlier
 * screens' answers, each with its follow ups (shown by a yes to it on this screen) under it. The
 * page shows follow ups while that yes is ticked; `parseScreen` ignores them otherwise.
 */
export function screenLayout(
  screen: HealthFormScreen,
  answers: HealthFormAnswers,
): HealthFormRow[] {
  const here = new Set(screen.fields.map((field) => field.key));
  const rows: HealthFormRow[] = [];
  for (const field of screen.fields) {
    const conditions = field.showIf ?? [];
    if (!conditions.filter((c) => !here.has(c.answer)).every((c) => holds(c, answers))) continue;
    const parent = conditions.find((c) => here.has(c.answer) && 'is' in c && c.is === true);
    const row = parent && rows.find((r) => r.field.key === parent.answer);
    if (row) row.followUps.push(field);
    else rows.push({ field, followUps: [] });
  }
  return rows;
}

export const ANSWER_THIS = 'Answer this question.';

/** What a form post holds: one string per field, several for a multiple choice. */
export type PostedScreen = Readonly<Record<string, string | readonly string[] | undefined>>;

export type ParsedScreen =
  | { ok: true; answers: Record<string, HealthFormAnswer> }
  | { ok: false; errors: Record<string, string> };

/** One posted field, read as its kind; undefined when left empty. */
function readField(
  field: HealthFormField,
  raw: string | readonly string[] | undefined,
): { answer?: HealthFormAnswer; error?: string } {
  const one = (typeof raw === 'string' ? raw : raw?.[0])?.trim() ?? '';
  switch (field.kind) {
    case 'yes_no':
      if (one === 'yes') return { answer: true };
      if (one === 'no') return { answer: false };
      return one ? { error: ANSWER_THIS } : {};
    case 'number': {
      if (!one) return {};
      const value = /^\d{1,6}$/.test(one) ? Number(one) : NaN;
      return value <= field.max
        ? { answer: value }
        : { error: `Enter a whole number from 0 to ${String(field.max)}.` };
    }
    case 'single_choice':
      if (!one) return {};
      return field.options.some((o) => o.value === one) ? { answer: one } : { error: ANSWER_THIS };
    case 'multi_choice': {
      const many = (typeof raw === 'string' ? [raw] : (raw ?? [])).filter(Boolean);
      if (many.length === 0) return {};
      return many.every((value) => field.options.some((o) => o.value === value))
        ? { answer: [...new Set(many)] }
        : { error: ANSWER_THIS };
    }
    case 'text':
      if (!one) return {};
      return one.length <= field.maxLength
        ? { answer: one }
        : { error: `Use at most ${String(field.maxLength)} characters.` };
  }
}

/**
 * Reads a screen as posted. A field counts only while shown, on the earlier answers and those
 * just posted (a yes on this screen shows its follow ups); every shown field needs an answer
 * (PRD J2.4: warning signs are mandatory). Hidden fields' posted values are ignored.
 */
export function parseScreen(
  screen: HealthFormScreen,
  answers: HealthFormAnswers,
  posted: PostedScreen,
): ParsedScreen {
  const read = new Map(
    screen.fields.map((field) => [field.key, readField(field, posted[field.key])]),
  );
  // The earlier answers, with this screen's replaced by what was just posted.
  const merged: Record<string, HealthFormAnswer> = Object.fromEntries([
    ...Object.entries(answers).filter(([key]) => !read.has(key)),
    ...[...read].flatMap(([key, { answer }]): [string, HealthFormAnswer][] =>
      answer === undefined ? [] : [[key, answer]],
    ),
  ]);
  const errors: Record<string, string> = {};
  const fresh: Record<string, HealthFormAnswer> = {};
  for (const field of visibleFields(screen, merged)) {
    const { answer, error } = read.get(field.key) ?? {};
    if (error) errors[field.key] = error;
    else if (answer === undefined) errors[field.key] = ANSWER_THIS;
    else fresh[field.key] = answer;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers: fresh };
}

/** A screening question (SET-10) as a form field: its region and follow up rules as conditions. */
function screeningField(key: string, question: ScreeningQuestion): HealthFormField {
  const showIf: HealthFormCondition[] = [
    ...(question.regions ? [{ answer: 'region', in: question.regions }] : []),
    ...(question.askedWhen ? [{ answer: question.askedWhen, is: true }] : []),
  ];
  const base = { key, label: question.text, source: question.source, showIf };
  return question.kind === 'number'
    ? { ...base, kind: 'number', unit: question.unit, max: question.max }
    : { ...base, kind: 'yes_no' };
}

/**
 * Version 1 (user decision, 23 October 2026): the screens whose wording already exists, both
 * awaiting the client's approval of patient wording. The region (PRD J2.3 "your problem",
 * Blueprint Module 2 "Body region"), then the warning signs: the framework's screening questions,
 * back and neck ones for that region, weight loss follow ups after a yes. INT-05 adds the other
 * screens as a new version.
 */
const healthFormV1: HealthFormDefinition = {
  version: 'hf-1',
  screens: [
    {
      key: 'problem',
      title: 'Your problem',
      source: 'PRD J2.3 (your problem: region); Blueprint Module 2 (body region)',
      awaitingApproval: true,
      fields: [
        {
          key: 'region',
          kind: 'single_choice',
          label: 'Body region',
          source: 'Blueprint Module 2 (body region)',
          options: screeningRegions.map((region) => ({
            value: region,
            label: screeningRegionLabels[region],
          })),
        },
      ],
    },
    {
      key: 'warning_signs',
      title: 'Warning signs',
      source: 'PRD J2.3 (warning signs); Red Flag Screening Framework §1, §4A, §4B',
      awaitingApproval: true,
      fields: screeningQuestionKeys.map((key) => screeningField(key, screeningQuestions[key])),
    },
  ],
};

/** Every published version, kept for the answers given on it. */
export const healthForms: Readonly<Record<string, HealthFormDefinition>> = {
  [healthFormV1.version]: healthFormV1,
};

/** The version a new form starts on. */
export const currentHealthFormVersion = healthFormV1.version;
