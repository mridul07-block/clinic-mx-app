import { z } from 'zod';
import type { HealthFormAnswer } from './health-form';
import {
  subjectiveField,
  subjectiveFieldKeys,
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

/** What the clinician has written in each section; a new consultation is `{}`. */
export const consultationSectionsSchema = z.object({
  subjective: subjectiveSchema,
  screening: sectionSchema,
  objective: sectionSchema,
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

/** How many health form answers the clinician changed in Subjective (CLN-03). */
export function confirmedCount(sections: ConsultationSections): number {
  return Object.keys(sections.subjective.confirmed).length;
}

/** Whether a section holds anything the clinician wrote: notes, or changed answers. */
export function sectionStarted(sections: ConsultationSections, key: ConsultationSection): boolean {
  return sectionHasNotes(sections, key) || (key === 'subjective' && confirmedCount(sections) > 0);
}

/** The step before and after, for Back and Next; undefined at either end. */
export function adjacentSteps(step: ConsultationStep): {
  back: ConsultationStep | undefined;
  next: ConsultationStep | undefined;
} {
  const at = consultationSteps.indexOf(step);
  return { back: consultationSteps[at - 1], next: consultationSteps[at + 1] };
}
