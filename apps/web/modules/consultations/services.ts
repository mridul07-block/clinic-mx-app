import 'server-only';
import {
  consultationIntake,
  consultationRecord,
  knowledgeAssessment,
  knowledgeObjective,
  saveConsultationSections,
  type ConsultationEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  consultationSectionsSchema,
  recordVersionSchema,
  type AssessmentCatalog,
  type AssessmentSettings,
  type ConsultationSections,
  type DraftSaveResponse,
  type HealthFormAnswers,
  type KnowledgeMeasure,
  type KnowledgeSpecialTest,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { assertMay } from '../access/guard';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * The consultation (CLN-02, PRD J3.2): its own consultant writes it, section by section, saved by
 * autosave against its version (FND-08). Nobody else edits it, and a signed one refuses every
 * save: changes are addenda (rule 5). Row level security and the rules migration hold the same.
 */

/** A refusal the person reads; the endpoint answers it as not found or refused. */
export class ConsultationError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_found' | 'signed',
  ) {
    super(message);
    this.name = 'ConsultationError';
  }
}

export interface ConsultationView extends Omit<ConsultationEntry, 'sections'> {
  sections: ConsultationSections;
  /** What the patient told us on the submitted health form (CLN-03); empty when none. */
  patientAnswers: HealthFormAnswers;
  /** Every workbook's measures and special tests in the consultation's version (CLN-05). */
  objectiveCatalog: { measures: KnowledgeMeasure[]; specialTests: KnowledgeSpecialTest[] };
  /** The version's conditions and the client's diagnosis categories (CLN-06). */
  assessmentCatalog: AssessmentCatalog;
  /** The thresholds Assessment's suggestions use (CLN-06). */
  assessmentSettings: AssessmentSettings;
}

/** The `assessment.*` settings, as the suggestions take them. */
async function assessmentSettings(): Promise<AssessmentSettings> {
  const [irritabilityHighAbove, irritabilityLowBelow, acuteWeeksBelow, chronicWeeksAbove] =
    await Promise.all([
      getSetting('assessment.irritability_high_above'),
      getSetting('assessment.irritability_low_below'),
      getSetting('assessment.acute_weeks_below'),
      getSetting('assessment.chronic_weeks_above'),
    ]);
  return { irritabilityHighAbove, irritabilityLowBelow, acuteWeeksBelow, chronicWeeksAbove };
}

/** The person's own consultation, or undefined when there is none they write. */
export async function loadConsultation(
  actor: StaffMember,
  consultationId: string,
): Promise<ConsultationView | undefined> {
  assertMay(actor, 'consultant_records.write');
  if (!z.guid().safeParse(consultationId).success) return undefined;
  const read = await asStaff(actor, async (tx) => {
    const found = await consultationRecord(tx, consultationId);
    if (!found || found.physioId !== actor.id) return undefined;
    return {
      found,
      intake: await consultationIntake(tx, found.appointmentId),
      catalog: await knowledgeObjective(tx, found.kbVersionId),
      assessment: await knowledgeAssessment(tx, found.kbVersionId),
    };
  });
  if (!read) return undefined;
  return {
    ...read.found,
    sections: consultationSectionsSchema.parse(read.found.sections),
    patientAnswers: read.intake?.answers ?? {},
    objectiveCatalog: read.catalog,
    assessmentCatalog: read.assessment,
    assessmentSettings: await assessmentSettings(),
  };
}

export const saveConsultationSchema = z.object({
  consultationId: z.guid(),
  value: consultationSectionsSchema,
  baseVersion: recordVersionSchema,
});

/** Saves an autosaved draft of the sections at the version it started from. */
export const saveConsultation = staffService({
  action: 'consultant_records.write',
  input: saveConsultationSchema,
  run: async (tx, input, actor): Promise<DraftSaveResponse<ConsultationSections>> => {
    const found = await consultationRecord(tx, input.consultationId);
    if (!found || found.physioId !== actor.id) {
      throw new ConsultationError('That consultation was not found.', 'not_found');
    }
    if (found.status === 'signed') {
      throw new ConsultationError('This consultation is signed. Changes are addenda.', 'signed');
    }
    const saved = await saveConsultationSections(tx, found.id, input.baseVersion, input.value);
    if (saved.status === 'saved') return saved;
    return {
      status: 'conflict',
      version: saved.version,
      value: consultationSectionsSchema.parse(saved.row.sections),
    };
  },
});
