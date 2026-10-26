import 'server-only';
import {
  logClinicalView,
  reassessmentById,
  sessionVisit,
  signReassessment,
  staffTreatsNow,
  type SessionVisit,
  type StaffMember,
} from '@clinic-mx/db';
import { can, reassessmentDecisionSchema } from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { staffService } from '../access/service';
import { asStaffViewing } from '../access/staff-db';
import { reassessedItems, reassessedRows, type ReassessedRow } from '../sessions/reassessment';

/**
 * The consultant's review of a session 4 reassessment (OUT-05, PRD J5.10; decision 7 default;
 * docs/runbooks/sessions.md "Session 4 reassessment"): baseline against the session with the
 * change, and the written decision the episode's consultant signs once. Read where the session
 * note is read (row level security); each open is logged as a record view.
 */

/** Why a reassessment was refused, for the screen. */
export class ReassessmentError extends Error {
  override name = 'ReassessmentError';
}

export interface ReassessmentScreen {
  id: string;
  visit: SessionVisit;
  sessionNumber: number;
  consultantName: string;
  rows: ReassessedRow[];
  decision: { text: string; by: string; at: Date } | null;
  /** The reader is the episode's consultant, it is unsigned, and they may sign. */
  signs: boolean;
}

export async function loadReassessment(
  actor: StaffMember,
  id: string,
): Promise<ReassessmentScreen | undefined> {
  if (!can(actor, 'clinical.read')) throw new NotAllowedError();
  return asStaffViewing(actor, async (tx) => {
    const found = await reassessmentById(tx, id);
    if (!found) return undefined;
    const visit = await sessionVisit(tx, found.appointmentId);
    if (!visit) return undefined;
    const items = await reassessedItems(tx, found.episodeId, found.kbVersionId);
    await logClinicalView(tx, 'patient', visit.patientId);
    return {
      id: found.id,
      visit,
      sessionNumber: found.sessionNumber,
      consultantName: found.consultantName,
      rows: await reassessedRows(tx, items, found.sessionId, found.notTested),
      decision:
        found.decision && found.signedAt
          ? { text: found.decision, by: found.signedByName ?? '', at: found.signedAt }
          : null,
      signs:
        found.consultantId === actor.id &&
        found.signedAt === null &&
        can(actor, 'consultant_records.sign'),
    };
  });
}

/**
 * Signs the decision as the episode's consultant, with the Treats patients tick read now; the
 * database closes their task with it. Signed once; never changed.
 */
export const signReassessmentDecision = staffService({
  action: 'consultant_records.sign',
  input: reassessmentDecisionSchema,
  run: async (tx, input, actor): Promise<{ status: 'signed' }> => {
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new ReassessmentError('Signing needs the Treats patients tick.');
    }
    const found = await reassessmentById(tx, input.reassessmentId);
    if (!found) throw new ReassessmentError('That reassessment was not found.');
    if (found.signedAt) throw new ReassessmentError('This decision is signed already.');
    if (found.consultantId !== actor.id) {
      throw new ReassessmentError('Only the episode’s consultant signs this decision.');
    }
    const signed = await signReassessment(tx, {
      id: input.reassessmentId,
      decision: input.decision,
      by: actor.id,
    });
    if (signed === 'refused') throw new ReassessmentError('This decision is signed already.');
    return { status: 'signed' };
  },
});
