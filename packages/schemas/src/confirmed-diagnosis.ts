import { z } from 'zod';

/**
 * The confirmed diagnosis (AI-05; PRD section 6: "The learning label is the diagnosis confirmed at
 * review or discharge, not the first impression"; TAD section 7). A consultant confirms the signed
 * diagnosis, or changes it to another knowledge base condition, on the Review and discharge
 * screen. Never changed once made: a later confirmation is the label. The database stamps the stage
 * from the episode: Review while it is open, Discharge once it is discharged. Recommended defaults
 * chosen under the user's standing approval, 29 October 2026 (DECISION AI-05).
 */
export const confirmedDiagnosisStages = ['review', 'discharge'] as const;
export type ConfirmedDiagnosisStage = (typeof confirmedDiagnosisStages)[number];

export const confirmedDiagnosisStageLabels: Record<ConfirmedDiagnosisStage, string> = {
  review: 'At review',
  discharge: 'At discharge',
};

export const confirmDiagnosisSchema = z.strictObject({
  episodeId: z.guid({ error: 'That episode was not found.' }),
  /** The knowledge base condition, in the signed diagnosis's version. */
  conditionId: z
    .string({ error: 'Choose the condition.' })
    .trim()
    .min(1, { error: 'Choose the condition.' })
    .max(40, { error: 'Choose the condition.' }),
});
export type ConfirmDiagnosisInput = z.infer<typeof confirmDiagnosisSchema>;
