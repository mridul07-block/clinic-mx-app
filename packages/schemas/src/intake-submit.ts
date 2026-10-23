import type { HealthFormAnswers, HealthFormDefinition } from './health-form';
import { ageOn } from './patients';
import { screeningQuestionKeys, type ScreeningAnswers } from './red-flags';

/**
 * What a submitted health form leads to (INT-10, PRD J2.6): the screening answers the red flag
 * rules read, the precautions it records, and who is told. Pure: the pipeline in
 * `apps/web/modules/intake/pipeline.ts` does the writing.
 */

/** A red flag alert's life (TAD section 4); raised here, the rest with ALT-01. */
export const redFlagAlertStatuses = ['raised', 'reviewed', 'referred', 'closed'] as const;
export type RedFlagAlertStatus = (typeof redFlagAlertStatuses)[number];

export const redFlagAlertStatusLabels: Record<RedFlagAlertStatus, string> = {
  raised: 'Raised',
  reviewed: 'Reviewed',
  referred: 'Referred',
  closed: 'Closed',
};

/** What a staff member is told about (user decision, 23 October 2026: in app). */
export const notificationKinds = ['health_form_submitted', 'red_flag_emergency'] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export const notificationKindLabels: Record<NotificationKind, string> = {
  health_form_submitted: 'Health form submitted',
  red_flag_emergency: 'Red flag: emergency',
};

/** The form's answers to the screening questions (SET-10), as the red flag rules read them. */
export function intakeScreening(answers: HealthFormAnswers): ScreeningAnswers {
  const picked: ScreeningAnswers = {};
  for (const key of screeningQuestionKeys) {
    const answer = answers[key];
    if (typeof answer === 'boolean' || typeof answer === 'number') picked[key] = answer;
  }
  return picked;
}

/** Whole years on `today`: the date of birth the form gave, else the one on file; else unknown. */
export function intakeAge(
  answers: HealthFormAnswers,
  dateOfBirthOnFile: string | null,
  today: string,
): number | null {
  const answered = answers.date_of_birth;
  const dateOfBirth = typeof answered === 'string' ? answered : dateOfBirthOnFile;
  return dateOfBirth ? ageOn(dateOfBirth, today) : null;
}

/** The Health check question whose ticked items are the episode's precautions. */
export const PRECAUTIONS_FIELD = 'health_conditions';

export interface IntakePrecaution {
  key: string;
  /** As the patient saw it, on the form's version. */
  label: string;
}

/**
 * The precautions a form records: each Health check item ticked, "None of these" left out
 * (Blueprint Module 3: precautions ticked in the intake alert when a related modality is chosen).
 * None on a version without the Health check.
 */
export function intakePrecautions(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
): IntakePrecaution[] {
  const field = form.screens
    .flatMap((screen) => screen.fields)
    .find((candidate) => candidate.key === PRECAUTIONS_FIELD);
  const ticked = answers[PRECAUTIONS_FIELD];
  if (field?.kind !== 'multi_choice' || typeof ticked !== 'object') return [];
  return field.options
    .filter((option) => option.value !== field.exclusive && ticked.includes(option.value))
    .map((option) => ({ key: option.value, label: option.label }));
}
