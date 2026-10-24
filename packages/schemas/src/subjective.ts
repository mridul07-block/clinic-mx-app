import { bodyChartZoneByKey } from './body-chart';
import {
  allHold,
  currentHealthFormVersion,
  healthForms,
  type HealthFormAnswer,
  type HealthFormAnswers,
  type HealthFormField,
} from './health-form';

/**
 * The consultation's Subjective (CLN-03, Frontend Specification "Source label"): what the patient
 * told us on the health form, field by field, labelled Patient reported until the clinician
 * changes it, then Clinician confirmed with the patient's words kept beneath (user decisions 24
 * October 2026). The fields and their wording are the health form's own; warning signs and the
 * health check belong to Screening (CLN-04). Only the clinician's changes are stored; the health
 * form never changes.
 */

export const subjectiveGroups = [
  {
    key: 'problem',
    title: 'The problem',
    fieldKeys: [
      'region',
      'pain_site',
      'complaint',
      'onset',
      'how_started',
      'duration',
      'duration_unit',
      'pain_now',
      'pain_activity',
      'aggravating',
      'easing',
    ],
  },
  {
    key: 'activity',
    title: 'Activity and goal',
    fieldKeys: ['activities', 'activity_other', 'activity_level', 'activity_hours', 'goals'],
  },
  {
    key: 'history',
    title: 'History',
    fieldKeys: ['injuries', 'surgeries', 'investigations', 'medicines'],
  },
  { key: 'about', title: 'About the patient', fieldKeys: ['occupation', 'dominant_side'] },
] as const;

export type SubjectiveFieldKey = (typeof subjectiveGroups)[number]['fieldKeys'][number];

export const subjectiveFieldKeys: readonly SubjectiveFieldKey[] = subjectiveGroups.flatMap(
  (group) => group.fieldKeys,
);

const currentFields = new Map(
  (healthForms[currentHealthFormVersion]?.screens ?? []).flatMap((screen) =>
    screen.fields.map((field) => [field.key, field] as const),
  ),
);

/** A Subjective field as the current health form defines it. */
export function subjectiveField(key: SubjectiveFieldKey): HealthFormField {
  const field = currentFields.get(key);
  if (!field) throw new Error(`The health form has no field ${key}.`);
  return field;
}

/** Whether a field shows: "Other (specify)" only once Other is among the activities. */
export function subjectiveFieldShown(key: SubjectiveFieldKey, values: HealthFormAnswers): boolean {
  return allHold(subjectiveField(key).showIf, values);
}

// Array.isArray widens a readonly string[] to any[]; this keeps the element type.
const isList = (answer: HealthFormAnswer): answer is readonly string[] => Array.isArray(answer);

const isWhole = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * Whether the clinician's value fits the field. Empty (`''` or `[]`) is allowed: the clinician
 * cleared what the patient wrote.
 */
export function validSubjectiveAnswer(field: HealthFormField, answer: HealthFormAnswer): boolean {
  if (answer === '' || (isList(answer) && answer.length === 0)) return true;
  switch (field.kind) {
    case 'text':
      return typeof answer === 'string' && answer.length <= field.maxLength;
    case 'number':
      return isWhole(answer, 0, field.max);
    case 'scale':
      return isWhole(answer, field.min, field.max);
    case 'single_choice':
      return typeof answer === 'string' && field.options.some((o) => o.value === answer);
    case 'multi_choice': {
      if (!isList(answer)) return false;
      const known = answer.every((value) => field.options.some((o) => o.value === value));
      const exclusive = field.exclusive;
      return known && (!exclusive || !answer.includes(exclusive) || answer.length === 1);
    }
    case 'body_chart':
      return isList(answer) && answer.every((key) => bodyChartZoneByKey.has(key));
    case 'yes_no':
      return typeof answer === 'boolean';
    case 'date':
      return false;
  }
}

export type SubjectiveSource = 'clinician' | 'patient' | 'unanswered';

export const subjectiveSourceLabels: Record<SubjectiveSource, string> = {
  clinician: 'Clinician confirmed',
  patient: 'Patient reported',
  unanswered: 'Not answered',
};

const answered = (answer: HealthFormAnswer | undefined) =>
  answer !== undefined && answer !== '' && !(Array.isArray(answer) && answer.length === 0);

/** Who wrote the value shown: the clinician once they changed it, else the patient, if anyone. */
export function subjectiveSource(
  key: SubjectiveFieldKey,
  confirmed: Readonly<Partial<Record<SubjectiveFieldKey, HealthFormAnswer>>>,
  patientAnswers: HealthFormAnswers,
): SubjectiveSource {
  if (key in confirmed) return 'clinician';
  return answered(patientAnswers[key]) ? 'patient' : 'unanswered';
}

/** The value shown: the clinician's change, else the patient's answer. */
export function subjectiveValue(
  key: SubjectiveFieldKey,
  confirmed: Readonly<Partial<Record<SubjectiveFieldKey, HealthFormAnswer>>>,
  patientAnswers: HealthFormAnswers,
): HealthFormAnswer | undefined {
  return key in confirmed ? confirmed[key] : patientAnswers[key];
}

/** Whether an answer holds anything, for "Patient reported: nothing". */
export { answered as subjectiveAnswered };
