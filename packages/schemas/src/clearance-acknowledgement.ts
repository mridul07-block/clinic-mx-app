import { z } from 'zod';
import { parseSignature, type ConsentSignature } from './consent';
import { clearanceSignSchema, clearanceStatusLabels, type ClearanceStatus } from './readiness';

/**
 * The patient's clearance acknowledgement (OUT-09; PRD J6.5 "Patients acknowledge clearance and
 * warning signs on their phone"; SOP 14.2 "Patient/athlete consent and acknowledgment of residual
 * risk"; Frontend Specification "Clearance acknowledgement: Plan, warning signs to stop, residual
 * risk; tick and sign"). The consultant writes the three sections when signing Return to training
 * or Return to sport; the patient reads each, ticks it and signs. Recommended defaults chosen under
 * the user's standing approval, 30 October 2026 (DECISION OUT-09; docs/runbooks/sessions.md).
 */

/** The clearances the patient acknowledges (the Frontend Specification: "Return to training or sport"). */
export const acknowledgedClearances = ['return_to_training', 'return_to_sport'] as const;
export type AcknowledgedClearance = (typeof acknowledgedClearances)[number];

export function isAcknowledgedClearance(status: ClearanceStatus): status is AcknowledgedClearance {
  return (acknowledgedClearances as readonly string[]).includes(status);
}

/** The three sections, in the Frontend Specification's order and words. */
export const clearanceSections = ['plan', 'warning_signs', 'residual_risk'] as const;
export type ClearanceSection = (typeof clearanceSections)[number];

export const clearanceSectionTitles: Record<ClearanceSection, string> = {
  plan: 'Plan',
  warning_signs: 'Warning signs to stop',
  residual_risk: 'Residual risk',
};

/** What the consultant is asked to write in each, on the signing form. */
export const clearanceSectionHints: Record<ClearanceSection, string> = {
  plan: 'What the patient does from here.',
  warning_signs: 'When the patient stops and contacts the clinic.',
  residual_risk: 'The risk that remains, in the patient’s words.',
};

/**
 * The words each tick says. DECISION OUT-09: a placeholder until the clinic gives its wording (no
 * document gives it); new wording is a new version, asked again.
 */
export const clearanceTick = {
  version: 1,
  text: 'I have read and understood this.',
  placeholder: true,
} as const;

/** A section's consent record key: `clearance.<status>.<section>`. */
export function clearanceStatementKey(
  status: AcknowledgedClearance,
  section: ClearanceSection,
): string {
  return ['clearance', status, section].join('.');
}

/** The patient's page title: "Your clearance: Return to sport". */
export function clearanceAcknowledgementTitle(status: AcknowledgedClearance): string {
  return `Your clearance: ${clearanceStatusLabels[status]}`;
}

const sectionText = (title: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `Write the ${title.toLowerCase()} for the patient.` })
    .max(2000, { error: `Keep the ${title.toLowerCase()} under 2,000 characters.` });

/** The three sections a consultant writes when signing Return to training or Return to sport. */
export const clearanceTextsSchema = z.object({
  plan: sectionText(clearanceSectionTitles.plan),
  warningSigns: sectionText(clearanceSectionTitles.warning_signs),
  residualRisk: sectionText(clearanceSectionTitles.residual_risk),
});
export type ClearanceTexts = z.infer<typeof clearanceTextsSchema>;

/** The form field of each section, on the signing form and the patient's page. */
export const clearanceSectionFields: Record<ClearanceSection, keyof ClearanceTexts> = {
  plan: 'plan',
  warning_signs: 'warningSigns',
  residual_risk: 'residualRisk',
};

export type ParsedAcknowledgement =
  { ok: true; signature: ConsentSignature } | { ok: false; errors: Record<string, string> };

/**
 * "Done" on the patient's page: every section ticked (`tick-<section>` = 'yes'), then the
 * signature, drawn or typed. Nothing is declined: a patient unsure of a section asks first.
 */
export function parseClearanceAcknowledgement(
  posted: Readonly<Record<string, string | readonly string[] | undefined>>,
): ParsedAcknowledgement {
  const errors: Record<string, string> = {};
  for (const section of clearanceSections) {
    const raw = posted[['tick', section].join('-')];
    if ((typeof raw === 'string' ? raw : raw?.[0]) !== 'yes') {
      errors[section] = 'Tick this once you have read it. If anything is unclear, ask first.';
    }
  }
  const signed = parseSignature(posted);
  if (!signed.ok) errors.signature = signed.error;
  if (Object.keys(errors).length > 0 || !signed.ok) return { ok: false, errors };
  return { ok: true, signature: signed.signature };
}

/**
 * Signing a clearance (OUT-08), with the three sections the patient acknowledges for Return to
 * training and Return to sport (OUT-09); Rehabilitation complete has none.
 */
export const clearanceSignWithTextsSchema = clearanceSignSchema
  .extend({ texts: clearanceTextsSchema.optional() })
  .refine((input) => !isAcknowledgedClearance(input.status) || input.texts !== undefined, {
    error: 'Write the plan, the warning signs to stop and the residual risk for the patient.',
    path: ['texts'],
  });
export type ClearanceSignWithTextsInput = z.infer<typeof clearanceSignWithTextsSchema>;
