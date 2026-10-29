import { z } from 'zod';

/**
 * Patient content per condition (AI-07; TAD `kb_patient_content`; PRD J3.8, M13; SOP section 11,
 * the CLEAR framework). The four parts the TAD names, in the patient's words, written by a
 * consultant who treats patients (or generated once by AI when the gateway has its key) and shown
 * to patients only once such a consultant approves it. No clinical wording is written here.
 * Recommended defaults chosen under the user's standing approval, 29 October 2026 (DECISION
 * AI-07; docs/runbooks/patient-content.md).
 */

export const patientContentStatuses = ['draft', 'approved', 'superseded'] as const;
export type PatientContentStatus = (typeof patientContentStatuses)[number];

export const patientContentSources = ['clinician', 'ai'] as const;
export type PatientContentSource = (typeof patientContentSources)[number];

/** The four parts, in the TAD's order and words. */
export const patientContentParts = [
  'explanation',
  'roadmap',
  'homeAdvice',
  'warningSigns',
] as const;
export type PatientContentPart = (typeof patientContentParts)[number];

export const patientContentPartLabels: Record<PatientContentPart, string> = {
  explanation: 'Explanation',
  roadmap: 'Roadmap',
  homeAdvice: 'Home advice',
  warningSigns: 'Warning signs',
};

/** What each part holds, for the clinician writing it (SOP section 11, CLEAR). */
export const patientContentPartHints: Record<PatientContentPart, string> = {
  explanation: 'The condition in lay terms, why it happened and the tissues involved.',
  roadmap: 'The rehabilitation roadmap and the expected healing timeline.',
  homeAdvice: 'What to do and what not to do at home.',
  warningSigns: 'When to contact the clinic or seek care.',
};

export const PATIENT_CONTENT_MAX = 4000;

const part = (label: string) =>
  z
    .string({ error: `Write the ${label.toLowerCase()}.` })
    .trim()
    .min(1, { error: `Write the ${label.toLowerCase()}.` })
    .max(PATIENT_CONTENT_MAX, { error: `Keep the ${label.toLowerCase()} to 4000 characters.` });

/** A stable condition ID, for example ANK-001. */
export const conditionIdSchema = z
  .string()
  .regex(/^[A-Z]{2,4}-\d{3}$/, { error: 'That condition was not found.' });

/** A draft as a consultant saves it: the condition and its four parts. */
export const patientContentDraftSchema = z.object({
  conditionId: conditionIdSchema,
  explanation: part(patientContentPartLabels.explanation),
  roadmap: part(patientContentPartLabels.roadmap),
  homeAdvice: part(patientContentPartLabels.homeAdvice),
  warningSigns: part(patientContentPartLabels.warningSigns),
});
export type PatientContentDraft = z.infer<typeof patientContentDraftSchema>;

const revision = z.coerce
  .number({ error: 'Reload the page and try again.' })
  .int()
  .min(1, { error: 'Reload the page and try again.' });

/**
 * A save of the condition's draft: its four parts and, when a draft was open, which draft and
 * revision, so another consultant's save in between is not overwritten.
 */
export const patientContentSaveSchema = patientContentDraftSchema.extend({
  draftId: z.guid({ error: 'Reload the page and try again.' }).optional(),
  revision: revision.optional(),
});

/** Approving, or discarding, the condition's draft as read: which draft, and which revision. */
export const patientContentDecisionSchema = z.object({
  conditionId: conditionIdSchema,
  draftId: z.guid({ error: 'Reload the page and try again.' }),
  revision,
});

/** Where a condition's content stands, for the list. */
export type PatientContentState = 'none' | 'draft' | 'approved' | 'approved_with_draft';

export const patientContentStateLabels: Record<PatientContentState, string> = {
  none: 'No content yet',
  draft: 'Draft awaiting approval',
  approved: 'Approved',
  approved_with_draft: 'Approved, new draft awaiting approval',
};

export function patientContentState(has: {
  draft: boolean;
  approved: boolean;
}): PatientContentState {
  if (has.approved) return has.draft ? 'approved_with_draft' : 'approved';
  return has.draft ? 'draft' : 'none';
}
