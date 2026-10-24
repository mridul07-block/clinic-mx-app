import {
  allHold,
  currentHealthFormVersion,
  healthForms,
  type HealthFormAnswers,
  type HealthFormField,
} from './health-form';
import {
  screeningQuestionKeys,
  screeningQuestions,
  screeningRegions,
  type ScreeningQuestion,
  type ScreeningRegion,
} from './red-flags';

/**
 * The consultation's Screening (CLN-04, PRD J3.3): the red flag questions for the patient's region
 * and each precaution from the health check, every one confirmed by the clinician before the
 * record can be signed. Nothing is preselected: the clinician taps Yes or No (or enters the
 * number), with what the patient said beside it (user decisions 24 October 2026). The wording is
 * the framework's and the health form's, as the patient saw it.
 */

export interface ScreeningItem {
  key: string;
  kind: 'question' | 'precaution';
  text: string;
  input: 'yes_no' | 'number';
  unit?: string;
  max?: number;
}

/** The clinician's confirmations, by item key: yes or no, or a number. */
export type ScreeningConfirmed = Readonly<Partial<Record<string, boolean | number>>>;

const PRECAUTION = 'precaution.';

const healthConditions = (healthForms[currentHealthFormVersion]?.screens ?? [])
  .flatMap((screen) => screen.fields)
  .find((field) => field.key === 'health_conditions');
if (healthConditions?.kind !== 'multi_choice') {
  throw new Error('The health form has no health conditions list.');
}
const conditionsField: Extract<HealthFormField, { kind: 'multi_choice' }> = healthConditions;

/** The region the screening is for: the one Subjective shows, if it is a screening region. */
export function screeningRegionOf(region: unknown): ScreeningRegion | undefined {
  return screeningRegions.find((known) => known === region);
}

const questionItem = (key: string, question: ScreeningQuestion): ScreeningItem =>
  question.kind === 'number'
    ? {
        key,
        kind: 'question',
        text: question.text,
        input: 'number',
        unit: question.unit,
        max: question.max,
      }
    : { key, kind: 'question', text: question.text, input: 'yes_no' };

/**
 * The items asked, in order: the universal questions and the region's own (follow ups only after
 * the clinician confirms the question they follow is yes), then each precaution shown for the
 * patient's sex (pregnancy for a female patient), without "None of these".
 */
export function screeningItems(
  region: ScreeningRegion | undefined,
  sex: unknown,
  confirmed: ScreeningConfirmed,
): ScreeningItem[] {
  const questions = screeningQuestionKeys.flatMap((key) => {
    const question: ScreeningQuestion = screeningQuestions[key];
    if (question.regions && (!region || !question.regions.includes(region))) return [];
    if (question.askedWhen && confirmed[question.askedWhen] !== true) return [];
    return [questionItem(key, question)];
  });
  const precautions = conditionsField.options
    .filter((option) => option.value !== conditionsField.exclusive)
    .filter((option) => allHold(option.showIf, { sex: typeof sex === 'string' ? sex : '' }))
    .map((option): ScreeningItem => ({
      key: `${PRECAUTION}${option.value}`,
      kind: 'precaution',
      text: option.label,
      input: 'yes_no',
    }));
  return [...questions, ...precautions];
}

/** Every item key a confirmation may use, whatever the region or sex. */
export function isScreeningKey(key: string): boolean {
  if (key.startsWith(PRECAUTION)) {
    const value = key.slice(PRECAUTION.length);
    return (
      value !== conditionsField.exclusive && conditionsField.options.some((o) => o.value === value)
    );
  }
  return (screeningQuestionKeys as readonly string[]).includes(key);
}

/** Whether a confirmation fits its item: yes or no, or a whole number in range. */
export function validScreeningAnswer(key: string, value: boolean | number): boolean {
  if (!isScreeningKey(key)) return false;
  const question = key.startsWith(PRECAUTION)
    ? undefined
    : (screeningQuestions as Record<string, ScreeningQuestion>)[key];
  if (question?.kind === 'number') {
    return (
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= question.max
    );
  }
  return typeof value === 'boolean';
}

/**
 * What the patient said on the form: yes or no, a number, or nothing. A precaution is yes when
 * ticked and no when the list was answered without it.
 */
export function patientScreeningAnswer(
  item: ScreeningItem,
  answers: HealthFormAnswers,
): boolean | number | undefined {
  if (item.kind === 'precaution') {
    const ticked = answers.health_conditions;
    if (!Array.isArray(ticked) || ticked.length === 0) return undefined;
    return (ticked as readonly string[]).includes(item.key.slice(PRECAUTION.length));
  }
  const answer = answers[item.key];
  return typeof answer === 'boolean' || typeof answer === 'number' ? answer : undefined;
}

export interface ScreeningProgress {
  confirmed: number;
  total: number;
  complete: boolean;
}

/** How many of the items asked are confirmed; a confirmation left on one no longer asked is not counted. */
export function screeningProgress(
  region: ScreeningRegion | undefined,
  sex: unknown,
  confirmed: ScreeningConfirmed,
): ScreeningProgress {
  const items = screeningItems(region, sex, confirmed);
  const done = items.filter((item) => confirmed[item.key] !== undefined).length;
  return { confirmed: done, total: items.length, complete: done === items.length };
}

/** "Yes", "No", "3 kg" or "Not answered", for "Patient said: …". */
export function screeningAnswerText(
  item: ScreeningItem,
  answer: boolean | number | undefined,
): string {
  if (answer === undefined) return 'Not answered';
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  return item.unit ? `${String(answer)} ${item.unit}` : String(answer);
}
