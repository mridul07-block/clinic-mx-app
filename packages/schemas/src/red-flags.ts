import { z } from 'zod';

/**
 * Red flag screening (SET-10, PRD J2.3, J2.6, J3.10; TAD `kb_red_flag_rule`). The questions every
 * patient answers on the health form, the rules that read the answers, and the evaluator the form
 * submit (INT-10) runs. Rules are knowledge base data, versioned and approved by the Super Admin;
 * the evaluator is fixed, tested code (rule 3: safety is deterministic, never AI).
 *
 * Source: the client's Red Flag Screening Framework (`docs/Red_Flag_Updated (1).docx`), cited by
 * section. Decisions (user, 22 October 2026): rules use the framework's five triage categories,
 * shown as the Frontend Specification's three alert tiers; the rules are a draft from the
 * framework awaiting the client's clinical sign-off.
 */

/** The framework's triage categories (§2), most urgent first. */
export const redFlagTriages = [
  'immediate_emergency',
  'urgent_medical_referral',
  'urgent_imaging',
  'specialist_referral',
  'monitor_with_caution',
] as const;
export type RedFlagTriage = (typeof redFlagTriages)[number];

export const redFlagTriageLabels: Record<RedFlagTriage, string> = {
  immediate_emergency: 'Immediate emergency',
  urgent_medical_referral: 'Urgent medical referral',
  urgent_imaging: 'Urgent imaging',
  specialist_referral: 'Specialist referral',
  monitor_with_caution: 'Monitor with caution',
};

/**
 * How an alert shows (Frontend Specification "Alert tiers"): an emergency is the red banner that
 * stays until a clinician acknowledges it; a review is an amber tag and a task; information is a
 * quiet line.
 */
export const alertDisplays = ['emergency', 'review', 'information'] as const;
export type AlertDisplay = (typeof alertDisplays)[number];

export function alertDisplay(triage: RedFlagTriage): AlertDisplay {
  if (triage === 'immediate_emergency') return 'emergency';
  if (triage === 'monitor_with_caution') return 'information';
  return 'review';
}

/** The body regions a health form is about (the body chart), for region specific questions. */
export const screeningRegions = [
  'back',
  'neck',
  'shoulder',
  'elbow',
  'wrist_hand',
  'hip',
  'knee',
  'foot_ankle',
] as const;
export type ScreeningRegion = (typeof screeningRegions)[number];

export const screeningRegionLabels: Record<ScreeningRegion, string> = {
  back: 'Back',
  neck: 'Neck',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist_hand: 'Wrist and hand',
  hip: 'Hip',
  knee: 'Knee',
  foot_ankle: 'Foot and ankle',
};

/** The numbers a rule may compare an answer with; each is a setting (rule 6). */
export const screeningThresholdKeys = [
  'screening.weight_loss_kg',
  'screening.weight_loss_months',
  'screening.morning_stiffness_minutes',
] as const;
export type ScreeningThresholdKey = (typeof screeningThresholdKeys)[number];
export type ScreeningThresholds = Record<ScreeningThresholdKey, number>;

interface QuestionBase {
  /** As the patient reads it. */
  text: string;
  /** Where it comes from. */
  source: string;
  /** Asked only for these regions; asked of everyone when absent. */
  regions?: readonly ScreeningRegion[];
  /** Asked only when this other (yes or no) question was answered yes; a test checks the key. */
  askedWhen?: string;
}

export type ScreeningQuestion =
  | (QuestionBase & { kind: 'yes_no' })
  | (QuestionBase & { kind: 'number'; unit: string; max: number });

const universal = 'Framework §1 (universal screening questions)';

/**
 * The screening questions, all mandatory once asked (PRD J2.4: the warning sign screens are
 * mandatory). The universal ones are the framework's §1 wording; the back and neck ones add PRD
 * J2.3's region questions in the framework's terms (§4A, §4B). Patient wording awaits the
 * client's approval of patient content with the health form (INT-05).
 */
export const screeningQuestions = {
  weight_loss: {
    kind: 'yes_no',
    text: 'Have you had unexplained weight loss recently?',
    source: universal,
  },
  weight_loss_kg: {
    kind: 'number',
    unit: 'kg',
    max: 100,
    text: 'About how many kilograms have you lost?',
    source: 'Framework §13 (weight loss amount)',
    askedWhen: 'weight_loss',
  },
  weight_loss_months: {
    kind: 'number',
    unit: 'months',
    max: 60,
    text: 'Over about how many months?',
    source: 'Framework §13 (weight loss period)',
    askedWhen: 'weight_loss',
  },
  fever_sweats: {
    kind: 'yes_no',
    text: 'Do you have fever, chills, or night sweats?',
    source: universal,
  },
  night_pain: {
    kind: 'yes_no',
    text: 'Is your pain severe at night or unrelated to movement?',
    source: universal,
  },
  cancer_history: { kind: 'yes_no', text: 'Do you have a history of cancer?', source: universal },
  recent_infection_surgery: {
    kind: 'yes_no',
    text: 'Have you recently had an infection, surgery, or hospitalization?',
    source: universal,
  },
  immune_diabetes_steroids: {
    kind: 'yes_no',
    text: 'Are you immunocompromised, diabetic, or on long-term steroids?',
    source: universal,
  },
  recent_trauma: { kind: 'yes_no', text: 'Any recent trauma or accident?', source: universal },
  fatigue_weakness: {
    kind: 'yes_no',
    text: 'Do you have severe fatigue or unexplained weakness?',
    source: universal,
  },
  bowel_bladder_change: {
    kind: 'yes_no',
    text: 'Any recent bowel or bladder changes?',
    source: universal,
  },
  saddle_numbness: {
    kind: 'yes_no',
    text: 'Any numbness in the groin or saddle region?',
    source: universal,
  },
  dizziness_balance: {
    kind: 'yes_no',
    text: 'Do you have dizziness, blackouts, or balance problems?',
    source: universal,
  },
  progressive_weakness: {
    kind: 'yes_no',
    text: 'Any progressive neurological weakness?',
    source: universal,
  },
  hot_swollen_joint: {
    kind: 'yes_no',
    text: 'Any unexplained swelling, redness, or heat in a joint?',
    source: universal,
  },
  calf_chest_breath: {
    kind: 'yes_no',
    text: 'Do you have calf pain, breathlessness, or chest pain?',
    source: universal,
  },
  rapidly_worsening: { kind: 'yes_no', text: 'Are symptoms rapidly worsening?', source: universal },
  morning_stiffness_minutes: {
    kind: 'number',
    unit: 'minutes',
    max: 1440,
    text: 'If you are stiff in the morning, about how many minutes does it last? (0 if not stiff)',
    source: 'Framework §12 (morning stiffness)',
  },
  back_bladder: {
    kind: 'yes_no',
    text: 'Any difficulty starting to pass urine, or leaking urine you cannot control?',
    source: 'PRD J2.3 (back: bladder); framework §4A',
    regions: ['back'],
  },
  back_bowel: {
    kind: 'yes_no',
    text: 'Any loss of control of your bowels?',
    source: 'PRD J2.3 (back: bowel); framework §4A',
    regions: ['back'],
  },
  back_saddle: {
    kind: 'yes_no',
    text: 'Any numbness around your bottom or between your legs?',
    source: 'PRD J2.3 (back: saddle); framework §4A',
    regions: ['back'],
  },
  back_both_legs: {
    kind: 'yes_no',
    text: 'Any weakness in both legs that is getting worse?',
    source: 'Framework §4A (bilateral leg weakness)',
    regions: ['back'],
  },
  neck_dizziness: {
    kind: 'yes_no',
    text: 'Do you get new or different dizziness, or sudden falls?',
    source: 'PRD J2.3 (neck: dizziness); framework §4B (5Ds)',
    regions: ['neck'],
  },
  neck_double_vision: {
    kind: 'yes_no',
    text: 'Do you have double vision?',
    source: 'PRD J2.3 (neck: vision); framework §4B (5Ds)',
    regions: ['neck'],
  },
  neck_speech_swallow: {
    kind: 'yes_no',
    text: 'Any difficulty speaking or swallowing?',
    source: 'Framework §4B (5Ds)',
    regions: ['neck'],
  },
  neck_both_arms_walking: {
    kind: 'yes_no',
    text: 'Any tingling or weakness in both arms, or trouble with walking or balance?',
    source: 'Framework §4B (myelopathy)',
    regions: ['neck'],
  },
} as const satisfies Record<string, ScreeningQuestion>;

export type ScreeningQuestionKey = keyof typeof screeningQuestions;
export const screeningQuestionKeys = Object.keys(screeningQuestions) as [
  ScreeningQuestionKey,
  ...ScreeningQuestionKey[],
];

/** Answers as the form stores them: yes or no, a number, or not answered. */
export type ScreeningAnswers = Partial<Record<ScreeningQuestionKey, boolean | number | null>>;

/** The questions asked for a region, in order: the universal ones, then the region's own. */
export function questionsFor(
  region: ScreeningRegion,
  answers: ScreeningAnswers = {},
): ScreeningQuestionKey[] {
  return screeningQuestionKeys.filter((key) => {
    const question: ScreeningQuestion = screeningQuestions[key];
    if (question.regions && !question.regions.includes(region)) return false;
    return !question.askedWhen || answers[question.askedWhen as ScreeningQuestionKey] === true;
  });
}

const questionKey = z.enum(screeningQuestionKeys);
const bound = z.union([
  z.number().nonnegative(),
  z.strictObject({ setting: z.enum(screeningThresholdKeys) }),
]);

/** One condition of a trigger: an answer is yes, an answer reaches a number, or the age does. */
export const redFlagConditionSchema = z.union([
  z.strictObject({ question: questionKey, is: z.literal('yes') }),
  z.strictObject({ question: questionKey, atLeast: bound }),
  z.strictObject({ question: questionKey, atMost: bound }),
  z.strictObject({ age: z.strictObject({ atLeast: z.int().nonnegative() }) }),
  z.strictObject({ age: z.strictObject({ atMost: z.int().nonnegative() }) }),
]);
export type RedFlagCondition = z.infer<typeof redFlagConditionSchema>;

/**
 * A rule (TAD `kb_red_flag_rule`): where it applies, what raises it, its triage category and what
 * the clinician does. A trigger holds when every `all` condition holds and, if `any` is given, at
 * least one `any` condition holds.
 */
export const redFlagRuleSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-z0-9_.]*$/),
    name: z.string().trim().min(1),
    regions: z.array(z.enum(screeningRegions)),
    trigger: z.strictObject({
      all: z.array(redFlagConditionSchema).optional(),
      any: z.array(redFlagConditionSchema).optional(),
    }),
    triage: z.enum(redFlagTriages),
    action: z.string().trim().min(1),
    source: z.string().trim().min(1),
    signedOff: z.boolean(),
  })
  .refine((rule) => (rule.trigger.all?.length ?? 0) + (rule.trigger.any?.length ?? 0) > 0, {
    error: 'A rule needs at least one condition.',
    path: ['trigger'],
  });
export type RedFlagRule = z.infer<typeof redFlagRuleSchema>;

/** A list of rules with unique keys. */
export const redFlagRulesSchema = z
  .array(redFlagRuleSchema)
  .refine((rules) => new Set(rules.map((r) => r.key)).size === rules.length, {
    error: 'Rule keys must be unique.',
  });

export interface ScreeningContext {
  region: ScreeningRegion;
  /** Whole years, when known. */
  age: number | null;
}

export interface RaisedRedFlag {
  key: string;
  name: string;
  triage: RedFlagTriage;
  display: AlertDisplay;
  action: string;
}

export interface RedFlagResult {
  /** Raised rules, most urgent first, then by key. */
  raised: RaisedRedFlag[];
  /** Questions asked but not answered: never read as "no" (Frontend Specification: review). */
  missing: ScreeningQuestionKey[];
  /** The most urgent display: an emergency, a review (also for missing answers), or none. */
  display: AlertDisplay | null;
}

function holds(
  condition: RedFlagCondition,
  answers: ScreeningAnswers,
  context: ScreeningContext,
  thresholds: ScreeningThresholds,
): boolean {
  const limit = (value: z.infer<typeof bound>) =>
    typeof value === 'number' ? value : thresholds[value.setting];
  if ('age' in condition) {
    if (context.age === null) return false;
    return 'atLeast' in condition.age
      ? context.age >= condition.age.atLeast
      : context.age <= condition.age.atMost;
  }
  const answer = answers[condition.question];
  if ('is' in condition) return answer === true;
  if (typeof answer !== 'number') return false;
  return 'atLeast' in condition
    ? answer >= limit(condition.atLeast)
    : answer <= limit(condition.atMost);
}

/**
 * Runs the rules over a form's answers. A rule applies where its regions include the form's region
 * (or it names none). Deterministic and without I/O: the caller passes the version's rules and
 * the thresholds read from settings.
 */
export function evaluateRedFlags(
  rules: readonly RedFlagRule[],
  answers: ScreeningAnswers,
  context: ScreeningContext,
  thresholds: ScreeningThresholds,
): RedFlagResult {
  const check = (condition: RedFlagCondition) => holds(condition, answers, context, thresholds);
  const raised = rules
    .filter((rule) => rule.regions.length === 0 || rule.regions.includes(context.region))
    .filter(
      ({ trigger }) =>
        (trigger.all ?? []).every(check) && (!trigger.any?.length || trigger.any.some(check)),
    )
    .map((rule) => ({
      key: rule.key,
      name: rule.name,
      triage: rule.triage,
      display: alertDisplay(rule.triage),
      action: rule.action,
    }))
    .sort(
      (a, b) =>
        redFlagTriages.indexOf(a.triage) - redFlagTriages.indexOf(b.triage) ||
        a.key.localeCompare(b.key),
    );
  const missing = questionsFor(context.region, answers).filter(
    (key) => answers[key] === undefined || answers[key] === null,
  );
  const displays = [
    ...raised.map((flag) => flag.display),
    ...(missing.length > 0 ? (['review'] as const) : []),
  ];
  const display = alertDisplays.find((d) => displays.includes(d)) ?? null;
  return { raised, missing, display };
}

/** A condition in words for clinicians: "Saddle numbness is yes", "Age is at least 50". */
export function conditionText(
  condition: RedFlagCondition,
  thresholds?: Partial<ScreeningThresholds>,
): string {
  if ('age' in condition) {
    return 'atLeast' in condition.age
      ? `Age is at least ${condition.age.atLeast}`
      : `Age is at most ${condition.age.atMost}`;
  }
  const question: ScreeningQuestion = screeningQuestions[condition.question];
  const subject = `“${question.text}”`;
  if ('is' in condition) return `${subject} is yes`;
  const value = 'atLeast' in condition ? condition.atLeast : condition.atMost;
  const unit = question.kind === 'number' ? ` ${question.unit}` : '';
  const amount =
    typeof value === 'number'
      ? `${value}${unit}`
      : `${thresholds?.[value.setting] ?? `the setting ${value.setting}`}${thresholds?.[value.setting] === undefined ? '' : unit}`;
  return `${subject} is ${'atLeast' in condition ? 'at least' : 'at most'} ${amount}`;
}

/** A trigger in words: "All of: …; and any of: …". */
export function triggerText(
  trigger: RedFlagRule['trigger'],
  thresholds?: Partial<ScreeningThresholds>,
): string {
  const words = (conditions: RedFlagCondition[]) =>
    conditions.map((c) => conditionText(c, thresholds));
  const all = words(trigger.all ?? []);
  const any = words(trigger.any ?? []);
  const parts: string[] = [];
  if (all.length === 1 && any.length === 0) return all[0] as string;
  if (any.length === 1 && all.length === 0) return any[0] as string;
  if (all.length > 0) parts.push(`all of: ${all.join('; ')}`);
  if (any.length > 0) parts.push(`${all.length > 0 ? 'and ' : ''}any of: ${any.join('; ')}`);
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
