import { z } from 'zod';
import type { HealthFormAnswer, HealthFormAnswers } from './health-form';
import { knowledgeRegionKeys } from './knowledge';
import { measureEntrySchema, specialTestEntrySchema } from './objective';
import {
  screeningProgress,
  screeningRegionOf,
  validScreeningAnswer,
  type ScreeningConfirmed,
} from './screening';
import {
  subjectiveField,
  subjectiveFieldKeys,
  subjectiveValue,
  validSubjectiveAnswer,
  type SubjectiveFieldKey,
} from './subjective';

/**
 * The consultation (CLN-02, PRD J3.2, Frontend Specification "Consultation"): six steps in a
 * vertical stepper, one section at a time on phones with Next pinned. Each of the five sections
 * holds a notes box for now (user decision 24 October 2026); CLN-03 to CLN-07 add their
 * structured fields beside it, and Sign gets its gates and button with CLN-04 and CLN-09.
 */

export const consultationSteps = [
  'subjective',
  'screening',
  'objective',
  'assessment',
  'plan',
  'sign',
] as const;

export type ConsultationStep = (typeof consultationSteps)[number];

export const consultationStepLabels: Record<ConsultationStep, string> = {
  subjective: 'Subjective',
  screening: 'Screening',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
  sign: 'Sign',
};

/** The steps that hold what the clinician writes; Sign reviews them. */
export const consultationSections = [
  'subjective',
  'screening',
  'objective',
  'assessment',
  'plan',
] as const satisfies readonly ConsultationStep[];

export type ConsultationSection = (typeof consultationSections)[number];

export const consultationStatuses = ['draft', 'signed'] as const;
export type ConsultationStatus = (typeof consultationStatuses)[number];

/** The longest notes one section takes. */
export const CONSULTATION_NOTES_MAX = 10000;

const sectionSchema = z
  .object({
    notes: z
      .string()
      .max(
        CONSULTATION_NOTES_MAX,
        `Notes can be up to ${CONSULTATION_NOTES_MAX.toLocaleString('en-IN')} characters.`,
      )
      .default(''),
  })
  .default({ notes: '' });

const answerSchema = z.union([
  z.boolean(),
  z.number(),
  z.string().max(CONSULTATION_NOTES_MAX),
  z.array(z.string().max(100)).max(100),
]);

const isSubjectiveKey = (key: string): key is SubjectiveFieldKey =>
  (subjectiveFieldKeys as readonly string[]).includes(key);

/**
 * Subjective (CLN-03): the notes, and the health form answers the clinician changed, by field;
 * a field not here shows what the patient reported.
 */
const subjectiveSchema = z
  .object({
    notes: sectionSchema.unwrap().shape.notes,
    confirmed: z
      .record(z.string(), answerSchema)
      .default({})
      .superRefine((confirmed, context) => {
        for (const [key, answer] of Object.entries(confirmed)) {
          if (!isSubjectiveKey(key) || !validSubjectiveAnswer(subjectiveField(key), answer)) {
            context.addIssue({ code: 'custom', path: [key], message: 'Check this answer.' });
          }
        }
      })
      .transform((confirmed) => confirmed as Partial<Record<SubjectiveFieldKey, HealthFormAnswer>>),
  })
  .default({ notes: '', confirmed: {} });

/**
 * Screening (CLN-04): the notes, and each item the clinician confirmed, by item key: yes or no, or
 * a number.
 */
const screeningSchema = z
  .object({
    notes: sectionSchema.unwrap().shape.notes,
    confirmed: z
      .record(z.string(), z.union([z.boolean(), z.number()]))
      .default({})
      .superRefine((confirmed, context) => {
        for (const [key, answer] of Object.entries(confirmed)) {
          if (!validScreeningAnswer(key, answer)) {
            context.addIssue({ code: 'custom', path: [key], message: 'Check this answer.' });
          }
        }
      })
      .transform((confirmed) => confirmed as ScreeningConfirmed),
  })
  .default({ notes: '', confirmed: {} });

/**
 * Objective (CLN-05): the workbook (region) whose measures and special tests are used, the
 * involved side, each measure entered by its knowledge base key, and the special tests added.
 */
const objectiveSchema = z
  .object({
    notes: sectionSchema.unwrap().shape.notes,
    region: z.union([z.enum(knowledgeRegionKeys), z.literal('')]).default(''),
    side: z.enum(['left', 'right', '']).default(''),
    measures: z
      .record(
        z
          .string()
          .regex(/^[a-z_]+\.[a-z0-9_.]+$/)
          .max(120),
        measureEntrySchema,
      )
      .default({})
      .refine((measures) => Object.keys(measures).length <= 300, 'Too many measures.'),
    tests: z
      .array(specialTestEntrySchema)
      .max(100)
      .default([])
      .refine(
        (tests) => new Set(tests.map((test) => test.key)).size === tests.length,
        'Each test is added once.',
      ),
  })
  .default({ notes: '', region: '', side: '', measures: {}, tests: [] });

/** What the clinician has written in each section; a new consultation is `{}`. */
export const consultationSectionsSchema = z.object({
  subjective: subjectiveSchema,
  screening: screeningSchema,
  objective: objectiveSchema,
  assessment: sectionSchema,
  plan: sectionSchema,
});

export type ConsultationSections = z.infer<typeof consultationSectionsSchema>;

/** The step a `?section=` names, or Subjective. */
export function stepFromQuery(value: string | null | undefined): ConsultationStep {
  return consultationSteps.find((step) => step === value) ?? 'subjective';
}

/** Whether the clinician has written notes in a section. */
export function sectionHasNotes(sections: ConsultationSections, key: ConsultationSection): boolean {
  return sections[key].notes.trim().length > 0;
}

/**
 * How many answers the clinician changed in Subjective (CLN-03), confirmed in Screening (CLN-04),
 * or recorded in Objective (CLN-05: measures entered and tests added); none elsewhere.
 */
export function confirmedCount(sections: ConsultationSections, key: ConsultationSection): number {
  if (key === 'subjective') return Object.keys(sections.subjective.confirmed).length;
  if (key === 'screening') return Object.keys(sections.screening.confirmed).length;
  if (key === 'objective') {
    const entered = Object.values(sections.objective.measures).filter(
      (entry) =>
        entry.involved !== undefined || entry.uninvolved !== undefined || entry.value !== undefined,
    ).length;
    return entered + sections.objective.tests.length;
  }
  return 0;
}

/** Whether a section holds anything the clinician wrote: notes, or confirmed answers. */
export function sectionStarted(sections: ConsultationSections, key: ConsultationSection): boolean {
  return sectionHasNotes(sections, key) || confirmedCount(sections, key) > 0;
}

/** The screening of this consultation: its region (as Subjective shows it) and progress. */
export function consultationScreening(
  sections: ConsultationSections,
  patientAnswers: HealthFormAnswers,
) {
  const region = screeningRegionOf(
    subjectiveValue('region', sections.subjective.confirmed, patientAnswers),
  );
  return {
    region,
    sex: patientAnswers.sex,
    progress: screeningProgress(region, patientAnswers.sex, sections.screening.confirmed),
  };
}

/**
 * Why the consultation cannot be signed yet; empty when it can (CLN-04, PRD J3.3). The sign
 * service (CLN-09) refuses on any reason here, with the health form's answers read on the server.
 */
export function signingBlockers(
  sections: ConsultationSections,
  patientAnswers: HealthFormAnswers,
): string[] {
  const { progress } = consultationScreening(sections, patientAnswers);
  const left = progress.total - progress.confirmed;
  return progress.complete
    ? []
    : [`Signing needs every screening item confirmed: ${String(left)} left.`];
}

/** The step before and after, for Back and Next; undefined at either end. */
export function adjacentSteps(step: ConsultationStep): {
  back: ConsultationStep | undefined;
  next: ConsultationStep | undefined;
} {
  const at = consultationSteps.indexOf(step);
  return { back: consultationSteps[at - 1], next: consultationSteps[at + 1] };
}
