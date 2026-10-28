import 'server-only';
import {
  episodeRecord,
  knowledgeAssessment,
  latestConfirmedDiagnosis,
  latestSignedDiagnosis,
  recordConfirmedDiagnosis,
  staffTreatsNow,
  type DbOrTransaction,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  confirmDiagnosisSchema,
  type AssessmentCatalog,
  type ConfirmedDiagnosisStage,
  type KnowledgeRegion,
} from '@clinic-mx/schemas';
import { staffService } from '../access/service';
import { ReviewError } from './errors';

/**
 * The confirmed diagnosis (AI-05; PRD section 6: "The learning label is the diagnosis confirmed at
 * review or discharge, not the first impression"). On the Review and discharge screen a consultant
 * with the Treats patients tick confirms the episode's latest signed diagnosis, or changes it to
 * another condition of the same knowledge base version, at any time once it is signed, before or
 * after discharge. Never changed: a later confirmation is the label. Recommended defaults chosen
 * under the user's standing approval, 29 October 2026 (DECISION AI-05).
 */

export interface ConfirmDiagnosisView {
  /** The latest signed diagnosis; null before the consultation is signed. */
  signed: { conditionId: string; name: string } | null;
  /** The latest confirmation; null before one. */
  confirmed: {
    conditionId: string;
    name: string;
    stage: ConfirmedDiagnosisStage;
    changed: boolean;
    by: string;
    at: Date;
  } | null;
  /** The reader confirms here: the Consultant tick (the Treats patients tick is read on post). */
  confirms: boolean;
  /** The signed diagnosis's knowledge base conditions, to change it; null unless the reader confirms. */
  catalog: AssessmentCatalog | null;
  /** The signed condition's workbook, whose conditions the search lists first. */
  region: KnowledgeRegion | undefined;
}

/** The panel's view of the episode's diagnosis, under the reader's access. */
export async function confirmDiagnosisView(
  tx: DbOrTransaction,
  actor: StaffMember,
  episodeId: string,
): Promise<ConfirmDiagnosisView> {
  const signed = await latestSignedDiagnosis(tx, episodeId);
  const confirmed = await latestConfirmedDiagnosis(tx, episodeId);
  const confirms = Boolean(signed) && can(actor, 'consultant_records.sign') && !actor.support;
  const catalog = signed && confirms ? await knowledgeAssessment(tx, signed.kbVersionId) : null;
  return {
    signed: signed ? { conditionId: signed.conditionId, name: signed.name } : null,
    confirmed: confirmed
      ? {
          conditionId: confirmed.conditionId,
          name: confirmed.name,
          stage: confirmed.stage,
          changed: confirmed.changed,
          by: confirmed.confirmedByName,
          at: confirmed.confirmedAt,
        }
      : null,
    confirms,
    catalog,
    region: catalog?.conditions.find((c) => c.conditionId === signed?.conditionId)?.listings[0]
      ?.region,
  };
}

/** Confirms the episode's diagnosis as the condition given, from the signed diagnosis's version. */
export const confirmEpisodeDiagnosis = staffService({
  action: 'consultant_records.sign',
  input: confirmDiagnosisSchema,
  run: async (tx, input, actor): Promise<{ stage: ConfirmedDiagnosisStage }> => {
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new ReviewError('Confirming a diagnosis needs the Treats patients tick.');
    }
    if (!(await episodeRecord(tx, input.episodeId))) {
      throw new ReviewError('That episode was not found.');
    }
    const signed = await latestSignedDiagnosis(tx, input.episodeId);
    if (!signed) throw new ReviewError('Sign the consultation before confirming its diagnosis.');
    const catalog = await knowledgeAssessment(tx, signed.kbVersionId);
    if (!catalog.conditions.some((c) => c.conditionId === input.conditionId)) {
      throw new ReviewError('Choose a condition from the knowledge base.');
    }
    const stage = await recordConfirmedDiagnosis(tx, {
      episodeId: input.episodeId,
      source: signed,
      conditionId: input.conditionId,
      by: actor.id,
    });
    return { stage };
  },
});
