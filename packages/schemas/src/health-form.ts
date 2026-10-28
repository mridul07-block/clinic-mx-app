import {
  screeningQuestionKeys,
  screeningQuestions,
  screeningRegionLabels,
  screeningRegions,
  type ScreeningQuestion,
} from './red-flags';
import { bodyChartZoneByKey, bodyChartZones } from './body-chart';
import { partAStatements, type ConsentStage, type ConsentStatementKey } from './consent';
import { formatIstDate } from './ist';
import { patientSexes, patientSexLabels } from './patients';

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

/**
 * A screen, field or option shows only when an earlier answer is this value, or one of these, or
 * (a multiple choice) has this value among those ticked.
 */
export type HealthFormCondition =
  | { answer: string; is: boolean | number | string }
  | { answer: string; in: readonly string[] }
  | { answer: string; has: string };

interface FieldBase {
  key: string;
  /** As the patient reads it. */
  label: string;
  /** Where the wording comes from. */
  source: string;
  showIf?: readonly HealthFormCondition[];
  /** May be left empty, for the physio to complete (PRD J2.4); otherwise it needs an answer. */
  optional?: true;
}

export interface HealthFormOption {
  value: string;
  label: string;
  showIf?: readonly HealthFormCondition[];
}

export type HealthFormField =
  | (FieldBase & { kind: 'yes_no' })
  | (FieldBase & { kind: 'number'; unit: string; max: number })
  | (FieldBase & { kind: 'single_choice'; options: readonly HealthFormOption[] })
  | (FieldBase & {
      kind: 'multi_choice';
      options: readonly HealthFormOption[];
      /** The "None of these" value: ticked alone or not at all. */
      exclusive?: string;
    })
  | (FieldBase & { kind: 'text'; maxLength: number })
  /** A date as `YYYY-MM-DD`, not in the future. */
  | (FieldBase & { kind: 'date' })
  /** A whole number on a scale, its ends worded (a pain slider). */
  | (FieldBase & { kind: 'scale'; min: number; max: number; minLabel: string; maxLabel: string })
  /** Zones marked on the body chart (`body-chart.ts`), by key. */
  | (FieldBase & { kind: 'body_chart'; zones: readonly string[] });

export interface HealthFormScreen {
  /** Stable, in addresses and the record; never `end`. */
  key: string;
  title: string;
  source: string;
  fields: readonly HealthFormField[];
  showIf?: readonly HealthFormCondition[];
  /** Patient wording not yet approved by the client (INT-05 brings the approval). */
  awaitingApproval: boolean;
  /**
   * A consent screen (INT-06): its statements, recorded as consent records with a signature, not
   * as answers. It has no fields, so it is complete once accepted and signed.
   */
  consent?: { stage: ConsentStage; statements: readonly ConsentStatementKey[] };
  /** The patient may add report photos here (INT-05); they are reports, not answers. */
  reports?: true;
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
  if ('has' in condition) return typeof answer === 'object' && answer.includes(condition.has);
  return typeof answer === 'string' && condition.in.includes(answer);
}

/** Whether every condition holds on these answers (also the consultation's Subjective, CLN-03). */
export const allHold = (
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

/** A multiple choice's options shown on these answers. */
export function visibleOptions(
  options: readonly HealthFormOption[],
  answers: HealthFormAnswers,
): HealthFormOption[] {
  return options.filter((option) => allHold(option.showIf, answers));
}

/** An answer with ticked options a change has hidden taken out; none left is no answer. */
function keptAnswer(
  field: HealthFormField,
  answer: HealthFormAnswer,
  answers: HealthFormAnswers,
): HealthFormAnswer | undefined {
  if (field.kind !== 'multi_choice' || typeof answer !== 'object') return answer;
  const shown = new Set(visibleOptions(field.options, answers).map((option) => option.value));
  const kept = answer.filter((value) => shown.has(value));
  if (kept.length === answer.length) return answer;
  return kept.length > 0 ? kept : undefined;
}

/**
 * Keeps only the answers to fields still shown, in form order (conditions name earlier fields):
 * changing the region from back to knee drops the back questions' answers, and changing sex from
 * female drops a ticked pregnancy.
 */
export function pruneAnswers(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
): Record<string, HealthFormAnswer> {
  const kept: Record<string, HealthFormAnswer> = {};
  for (const screen of form.screens) {
    if (!allHold(screen.showIf, kept)) continue;
    for (const field of screen.fields) {
      const given = answers[field.key];
      const answer = given === undefined ? undefined : keptAnswer(field, given, kept);
      if (answer !== undefined && allHold(field.showIf, kept)) kept[field.key] = answer;
    }
  }
  return kept;
}

/** A shown screen is complete once it was sent and every field it shows that needs one has an answer. */
function complete(
  screen: HealthFormScreen,
  answers: HealthFormAnswers,
  done: readonly string[],
): boolean {
  return (
    done.includes(screen.key) &&
    visibleFields(screen, answers).every(
      (field) => field.optional || answers[field.key] !== undefined,
    )
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

/**
 * A question on a screen and the follow ups its answer shows: a yes, or (a multiple choice) one
 * box ticked, the `trigger` value.
 */
export interface HealthFormRow {
  field: HealthFormField;
  followUps: HealthFormField[];
  trigger?: string;
}

/** The posted value on this screen that shows a follow up, if the condition is one. */
function triggerOf(condition: HealthFormCondition): string | undefined {
  if ('has' in condition) return condition.has;
  return 'is' in condition && condition.is === true ? 'yes' : undefined;
}

/**
 * A screen as the page lays it out, working without scripts: the questions shown on earlier
 * screens' answers, each with its follow ups (shown by a yes to it, or a box ticked, on this
 * screen) under it. The page shows follow ups while that answer is ticked; `parseScreen` ignores
 * them otherwise.
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
    const parent = conditions.find((c) => here.has(c.answer) && triggerOf(c) !== undefined);
    const row = parent && rows.find((r) => r.field.key === parent.answer);
    if (row) {
      row.followUps.push(field);
      row.trigger = triggerOf(parent);
    } else rows.push({ field, followUps: [] });
  }
  return rows;
}

export const ANSWER_THIS = 'Answer this question.';

/** What a form post holds: one string per field, several for a multiple choice. */
export type PostedScreen = Readonly<Record<string, string | readonly string[] | undefined>>;

export type ParsedScreen =
  | { ok: true; answers: Record<string, HealthFormAnswer> }
  | { ok: false; errors: Record<string, string> };

export const REAL_DATE = 'Enter a real date, not in the future.';
export const NONE_ALONE = 'Choose None of these, or the ones that apply.';

const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date as `YYYY-MM-DD`. */
function realDate(text: string): boolean {
  const parts = isoDate.exec(text);
  if (!parts) return false;
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  return date.toISOString().slice(0, 10) === text && Number(parts[1]) >= 1900;
}

/** What reading a post needs beyond the form: today's date in IST, for dates. */
export interface ParseContext {
  today: string;
}

/** One posted field, read as its kind; undefined when left empty. */
function readField(
  field: HealthFormField,
  raw: string | readonly string[] | undefined,
  context: ParseContext,
): { answer?: HealthFormAnswer; error?: string } {
  const one = (typeof raw === 'string' ? raw : raw?.[0])?.trim() ?? '';
  const many = () => (typeof raw === 'string' ? [raw] : (raw ?? [])).filter(Boolean);
  switch (field.kind) {
    case 'date':
      if (!one) return {};
      return realDate(one) && one <= context.today ? { answer: one } : { error: REAL_DATE };
    case 'scale': {
      if (!one) return {};
      const value = /^\d{1,2}$/.test(one) ? Number(one) : NaN;
      return value >= field.min && value <= field.max
        ? { answer: value }
        : { error: `Choose a number from ${String(field.min)} to ${String(field.max)}.` };
    }
    case 'body_chart': {
      const zones = many();
      if (zones.length === 0) return {};
      return zones.every((zone) => field.zones.includes(zone))
        ? { answer: [...new Set(zones)] }
        : { error: ANSWER_THIS };
    }
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
      const ticked = [...new Set(many())];
      if (ticked.length === 0) return {};
      if (!ticked.every((value) => field.options.some((o) => o.value === value))) {
        return { error: ANSWER_THIS };
      }
      if (field.exclusive && ticked.includes(field.exclusive) && ticked.length > 1) {
        return { error: NONE_ALONE };
      }
      return { answer: ticked };
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
 * unless optional (PRD J2.4: warning signs and the health check are mandatory). Hidden fields'
 * posted values are ignored; a ticked option that is not shown is refused.
 */
export function parseScreen(
  screen: HealthFormScreen,
  answers: HealthFormAnswers,
  posted: PostedScreen,
  context: ParseContext,
): ParsedScreen {
  const read = new Map(
    screen.fields.map((field) => [field.key, readField(field, posted[field.key], context)]),
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
    else if (answer === undefined) {
      if (!field.optional) errors[field.key] = ANSWER_THIS;
    } else if (keptAnswer(field, answer, merged) !== answer) errors[field.key] = ANSWER_THIS;
    else fresh[field.key] = answer;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers: fresh };
}

/** A saved answer as the form posts it back. */
export function postedAnswer(answer: HealthFormAnswer): string | string[] {
  if (typeof answer === 'boolean') return answer ? 'yes' : 'no';
  if (typeof answer === 'number') return String(answer);
  return typeof answer === 'string' ? answer : [...answer];
}

/**
 * A saved answer read again as if posted to this field (INT-08): what the field takes today, or
 * undefined when it would refuse it, so an answer from an earlier form passes the same checks.
 */
export function readAnswer(
  field: HealthFormField,
  answer: HealthFormAnswer,
  context: ParseContext,
): HealthFormAnswer | undefined {
  const read = readField(field, postedAnswer(answer), context);
  return read.error ? undefined : read.answer;
}

/** An answer as Check and submit reads it back (INT-05). */
export function answerText(field: HealthFormField, answer: HealthFormAnswer): string {
  const list: readonly string[] =
    typeof answer === 'string' ? [answer] : typeof answer === 'object' ? answer : [];
  switch (field.kind) {
    case 'yes_no':
      return answer === true ? 'Yes' : 'No';
    case 'number':
      return field.unit ? `${String(answer)} ${field.unit}` : String(answer);
    case 'scale':
      return `${String(answer)} out of ${String(field.max)}`;
    case 'date':
      return typeof answer === 'string' ? formatIstDate(answer) : '';
    case 'single_choice':
    case 'multi_choice':
      return list
        .map((value) => field.options.find((option) => option.value === value)?.label ?? value)
        .join(', ');
    case 'body_chart':
      return list.map((key) => bodyChartZoneByKey.get(key)?.label ?? key).join(', ');
    case 'text':
      return String(answer);
  }
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
/**
 * Version 2 (INT-06, user decision 23 October 2026): Part A consent first ("Welcome and Part A
 * consent", Frontend Specification §7; the Blueprint's title), then version 1's screens. The
 * questions open only after both statements are accepted and signed.
 */
const healthFormV2: HealthFormDefinition = {
  version: 'hf-2',
  screens: [
    {
      key: 'consent',
      title: 'Pre-consultation consent',
      source: 'Blueprint Module 3, Part A',
      awaitingApproval: false,
      fields: [],
      consent: { stage: 'A', statements: partAStatements },
    },
    ...healthFormV1.screens,
  ],
};

const blueprint = 'Blueprint Module 2';
const sop = 'Consultation SOP (pre-consultation intake)';
const choices = (pairs: readonly (readonly [string, string])[]): HealthFormOption[] =>
  pairs.map(([value, label]) => ({ value, label }));
const longText = 500;

/** The Blueprint's activity list, in its order ("Physical activity level"). */
const activityOptions = choices([
  ['not_active', 'Not regularly active'],
  ['walking', 'Walking / recreational'],
  ['running', 'Running'],
  ['gym', 'Gym'],
  ['football', 'Football / soccer'],
  ['cricket', 'Cricket'],
  ['basketball', 'Basketball'],
  ['volleyball', 'Volleyball'],
  ['tennis', 'Tennis'],
  ['badminton', 'Badminton'],
  ['hockey', 'Hockey'],
  ['baseball', 'Baseball'],
  ['sprinting', 'Sprinting'],
  ['track_field', 'Track & field'],
  ['swimming', 'Swimming'],
  ['rowing', 'Rowing'],
  ['cycling', 'Cycling'],
  ['weightlifting', 'Weightlifting'],
  ['crossfit', 'CrossFit'],
  ['gymnastics', 'Gymnastics'],
  ['dance', 'Dance / ballet'],
  ['martial_arts', 'Martial arts'],
  ['wrestling', 'Wrestling / judo'],
  ['figure_skating', 'Figure skating'],
  ['golf', 'Golf'],
  ['climbing', 'Rock climbing'],
  ['kabaddi', 'Kabaddi'],
  ['other', 'Other (specify)'],
]);

const painScale = (key: string, label: string): HealthFormField => ({
  key,
  kind: 'scale',
  label,
  source: `PRD J2.3 (pain now and with activity, 0 to 10); ${sop} (NPRS at rest and activity)`,
  min: 0,
  max: 10,
  minLabel: 'No pain',
  maxLabel: 'Worst pain you can imagine',
  optional: true,
});

const optionalText = (key: string, label: string, source: string): HealthFormField => ({
  key,
  kind: 'text',
  label,
  source,
  maxLength: longText,
  optional: true,
});

/**
 * Version 3 (INT-05, user decisions 23 October 2026): every PRD J2.3 screen. The wording is the
 * Blueprint's Module 2 fields (and the SOP's intake list for occupation, dominant side and
 * goals), awaiting the client's approval of patient wording. Per J2.4 the warning signs and the
 * health check are mandatory, and so are the region (it decides the back and neck questions) and
 * gender (it decides the pregnancy question, a precaution); the physio completes the rest.
 */
const healthFormV3: HealthFormDefinition = {
  version: 'hf-3',
  screens: [
    healthFormV2.screens[0] as HealthFormScreen,
    {
      key: 'about_you',
      title: 'About you',
      source: `PRD J2.3 (about you); ${blueprint} (personal details); ${sop}`,
      awaitingApproval: true,
      fields: [
        {
          key: 'date_of_birth',
          kind: 'date',
          label: 'Date of birth',
          source: `${blueprint} (personal details: age)`,
          optional: true,
        },
        {
          key: 'sex',
          kind: 'single_choice',
          label: 'Gender',
          source: `${blueprint} (personal details: gender)`,
          options: patientSexes.map((sex) => ({ value: sex, label: patientSexLabels[sex] })),
        },
        {
          key: 'occupation',
          kind: 'text',
          label: 'Occupation',
          source: `${sop} (occupation)`,
          maxLength: 100,
          optional: true,
        },
        {
          key: 'dominant_side',
          kind: 'single_choice',
          label: 'Dominant side',
          source: `${sop} (dominant side)`,
          options: choices([
            ['right', 'Right'],
            ['left', 'Left'],
            ['both', 'Both'],
          ]),
          optional: true,
        },
      ],
    },
    {
      key: 'problem',
      title: 'Your problem',
      source: `PRD J2.3 (your problem); ${blueprint} (chief complaint, symptoms)`,
      awaitingApproval: true,
      fields: [
        ...(healthFormV1.screens[0]?.fields ?? []),
        {
          key: 'pain_site',
          kind: 'body_chart',
          label: 'Pain site (mark it on the body chart)',
          source: `${blueprint} (pain site, marked on body chart)`,
          zones: bodyChartZones.map((zone) => zone.key),
          optional: true,
        },
        optionalText('complaint', 'Main complaint', `${blueprint} (main complaint)`),
        {
          key: 'onset',
          kind: 'single_choice',
          label: 'Onset',
          source: `${blueprint} (onset: gradual (slow) / sudden)`,
          options: choices([
            ['gradual', 'Gradual (slow)'],
            ['sudden', 'Sudden'],
          ]),
          optional: true,
        },
        optionalText('how_started', 'How the pain started', `${blueprint} (how the pain started)`),
        {
          key: 'duration',
          kind: 'number',
          label: 'Duration',
          source: 'PRD J2.3 (duration)',
          unit: '',
          max: 99,
          optional: true,
        },
        {
          key: 'duration_unit',
          kind: 'single_choice',
          label: 'Duration in',
          source: 'PRD J2.3 (duration)',
          options: choices([
            ['days', 'Days'],
            ['weeks', 'Weeks'],
            ['months', 'Months'],
            ['years', 'Years'],
          ]),
          optional: true,
        },
        painScale('pain_now', 'Pain now'),
        painScale('pain_activity', 'Pain with activity'),
        optionalText(
          'aggravating',
          'Aggravating factors: activities that increase the pain',
          `${blueprint} (aggravating factors)`,
        ),
        optionalText(
          'easing',
          'Easing factors: activities that decrease the pain',
          `${blueprint} (easing factors)`,
        ),
      ],
    },
    healthFormV1.screens[1] as HealthFormScreen,
    {
      key: 'health_check',
      title: 'Health check',
      source: `PRD J2.3 (health check); ${blueprint} (health screening); Frontend Specification §7`,
      awaitingApproval: true,
      fields: [
        {
          key: 'health_conditions',
          kind: 'multi_choice',
          label: 'Tick any that apply',
          source: `${blueprint} (health screening); Frontend Specification §7 ("None of these")`,
          options: [
            ...choices([
              ['implant', 'Any implant (pacemaker / electronic or metal)'],
              ['steroids', 'Steroid use (tablets or injection)'],
            ]),
            {
              value: 'pregnancy',
              label: 'Pregnancy / breastfeeding',
              showIf: [{ answer: 'sex', is: 'female' }],
            },
            ...choices([
              ['cancer', 'Cancer (current or past)'],
              ['osteoporosis', 'Osteoporosis'],
              ['diabetes', 'Diabetes'],
              ['heart_disease', 'Heart disease'],
              ['hypertension', 'Hypertension'],
              ['blood_clot', 'Blood clot history or recent long immobility'],
              ['bleeding', 'Bleeding disorder or blood thinners'],
              ['chronic_infection', 'Chronic infection'],
              ['none', 'None of these'],
            ]),
          ],
          exclusive: 'none',
        },
        optionalText(
          'medicines',
          'Any regular medicines (list)',
          `${blueprint} (regular medicines)`,
        ),
      ],
    },
    {
      key: 'activity',
      title: 'Activity and goal',
      source: `PRD J2.3 (activity and goal); ${blueprint} (physical activity level); ${sop} (patient goals)`,
      awaitingApproval: true,
      fields: [
        {
          key: 'activities',
          kind: 'multi_choice',
          label: 'Activity',
          source: `${blueprint} (physical activity level: activity)`,
          options: activityOptions,
          optional: true,
        },
        {
          ...optionalText('activity_other', 'Other (specify)', `${blueprint} (other, specify)`),
          showIf: [{ answer: 'activities', has: 'other' }],
        },
        {
          key: 'activity_level',
          kind: 'single_choice',
          label: 'Level',
          source: `${blueprint} (level: recreational / competitive / professional)`,
          options: choices([
            ['recreational', 'Recreational'],
            ['competitive', 'Competitive'],
            ['professional', 'Professional'],
          ]),
          optional: true,
        },
        {
          key: 'activity_hours',
          kind: 'number',
          label: 'Hours per week',
          source: `${blueprint} (hours per week)`,
          unit: 'hours',
          max: 168,
          optional: true,
        },
        optionalText('goals', 'Your goals', `${sop} (patient goals)`),
      ],
    },
    {
      key: 'history',
      title: 'History',
      source: `PRD J2.3 (history with optional report photo); ${blueprint} (medical history)`,
      awaitingApproval: true,
      reports: true,
      fields: [
        optionalText('injuries', 'Previous injuries', `${blueprint} (previous injuries)`),
        optionalText('surgeries', 'Surgeries', `${blueprint} (surgeries)`),
        optionalText(
          'investigations',
          'Investigations (scans or tests)',
          `${blueprint} (investigations)`,
        ),
      ],
    },
  ],
};

export const healthForms: Readonly<Record<string, HealthFormDefinition>> = {
  [healthFormV1.version]: healthFormV1,
  [healthFormV2.version]: healthFormV2,
  [healthFormV3.version]: healthFormV3,
};

/** The version a new form starts on. */
export const currentHealthFormVersion = healthFormV3.version;
