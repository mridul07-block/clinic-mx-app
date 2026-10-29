import 'server-only';
import { patientContentOf, type PatientContentEntry, type StaffMember } from '@clinic-mx/db';
import { can } from '@clinic-mx/schemas';
import { asStaff } from '../access/staff-db';
import { loadConsultation } from './services';

/**
 * "Explain to patient" (CLN-08; PRD J3.8: "shows clinician approved content for the diagnosis";
 * Frontend Specification, Consultation): the patient content a consultant who treats patients
 * approved (AI-07) for the condition chosen in the consultation's assessment, to show the patient.
 * Nothing else is shown: never a draft. Recommended defaults chosen under the user's standing
 * approval, 29 October 2026 (DECISION CLN-08; docs/runbooks/patient-content.md).
 */
export interface ExplanationView {
  consultationId: string;
  patientName: string;
  /** The condition chosen in the assessment; null before one is chosen. */
  condition: { id: string; name: string } | null;
  /** Its approved content; undefined when none is approved. */
  content: PatientContentEntry | undefined;
  /** Whether the reader may write and approve it (to point them to it when there is none). */
  writes: boolean;
}

/** The explanation for a consultation the reader may open; undefined when they cannot. */
export async function loadExplanation(
  actor: StaffMember,
  consultationId: string,
): Promise<ExplanationView | undefined> {
  const consultation = await loadConsultation(actor, consultationId);
  if (!consultation) return undefined;
  const conditionId = consultation.sections.assessment.conditionId;
  const found = conditionId
    ? consultation.assessmentCatalog.conditions.find((c) => c.conditionId === conditionId)
    : undefined;
  const condition = found ? { id: found.conditionId, name: found.name } : null;
  const content = condition
    ? (await asStaff(actor, (tx) => patientContentOf(tx, condition.id))).approved
    : undefined;
  return {
    consultationId: consultation.id,
    patientName: consultation.patientName,
    condition,
    content,
    writes: !actor.support && can(actor, 'patient_content.approve'),
  };
}
