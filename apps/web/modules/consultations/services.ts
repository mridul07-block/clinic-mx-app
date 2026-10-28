import 'server-only';
import {
  addAddendum,
  consultationAddenda,
  consultationIntake,
  consultationRecord,
  episodeRecord,
  knowledgeAssessment,
  knowledgeObjective,
  knowledgePlan,
  logClinicalView,
  recordStaffName,
  saveConsultationSections,
  signConsultation,
  staffTreatsNow,
  treatingPhysios,
  type AddendumEntry,
  type ConsultationEntry,
  type DbOrTransaction,
  type StaffMember,
} from '@clinic-mx/db';
import {
  addendumSchema,
  can,
  consultationSectionsSchema,
  episodeTransition,
  istDate,
  recordVersionSchema,
  signedRecord,
  signingBlockers,
  worksAtCentre,
  type AssessmentCatalog,
  type AssessmentSettings,
  type ConsultationSections,
  type DraftSaveResponse,
  type HealthFormAnswers,
  type KnowledgeMeasure,
  type KnowledgeSpecialTest,
  type PlanCatalog,
  type PlanDefaults,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { NotAllowedError } from '../access/guard';
import { staffService } from '../access/service';
import { asStaffViewing } from '../access/staff-db';
import { changeEpisodeStatus } from '../episodes/services';
import { getSetting } from '../settings/settings';

/**
 * The consultation (CLN-02, PRD J3.2): its own consultant writes it, section by section, saved by
 * autosave against its version (FND-08), and signs it (CLN-09): the Treats patients tick checked
 * at that moment, every gate passed, the record's rows written and the visit completed. A signed
 * one never changes; clinicians read it at any centre (CLN-12, kickoff decision C1), each open by
 * someone else logged as a record view, and those at its centre add addenda (rule 5). Row level
 * security and the rules migrations hold the same.
 */

/** A refusal the person reads; the endpoint answers it as not found or refused. */
export class ConsultationError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_found' | 'signed' | 'refused' | 'stale',
  ) {
    super(message);
    this.name = 'ConsultationError';
  }
}

/** What a consultation is read and signed against: the patient's answers and its version. */
interface RecordContext {
  patientAnswers: HealthFormAnswers;
  /**
   * A returning patient's answer to "Has anything changed?" (INT-08) and when the form the details
   * came from was submitted; null for a first form.
   */
  detailsReview: { changed: boolean; carriedFromAt: Date } | null;
  objectiveCatalog: { measures: KnowledgeMeasure[]; specialTests: KnowledgeSpecialTest[] };
  assessmentCatalog: AssessmentCatalog;
  planCatalog: PlanCatalog;
  treatingPhysios: { id: string; name: string }[];
  planDefaults: PlanDefaults;
}

export interface ConsultationView extends Omit<ConsultationEntry, 'sections'>, RecordContext {
  sections: ConsultationSections;
  /** The thresholds Assessment's suggestions use (CLN-06). */
  assessmentSettings: AssessmentSettings;
  /** Whether the person writes it: its own consultant, while a draft. */
  editable: boolean;
  /** Addenda, oldest first, and whether the person may add one (CLN-09). */
  addenda: AddendumEntry[];
  addsAddenda: boolean;
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

/** The intake, the version's catalogs, who may treat, and the plan's defaults. */
async function recordContext(
  tx: DbOrTransaction,
  found: ConsultationEntry,
  consultantName: string,
): Promise<RecordContext> {
  const intake = await consultationIntake(tx, found.appointmentId);
  const physios = await treatingPhysios(tx, found.centreId);
  return {
    patientAnswers: intake?.answers ?? {},
    detailsReview: intake?.detailsReview ?? null,
    objectiveCatalog: await knowledgeObjective(tx, found.kbVersionId),
    assessmentCatalog: await knowledgeAssessment(tx, found.kbVersionId),
    planCatalog: await knowledgePlan(tx, found.kbVersionId),
    // The consultant is the default treating physio even where they are not assigned to the centre.
    treatingPhysios: physios.some((physio) => physio.id === found.physioId)
      ? physios
      : [...physios, { id: found.physioId, name: consultantName }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
    planDefaults: {
      visitDate: istDate(found.startsAt),
      reviewWeeks: await getSetting('clinical.review_weeks'),
      consultantId: found.physioId,
    },
  };
}

/**
 * A consultation the person may open: their own as its consultant, or a signed one when they read
 * clinical records, at any centre (CLN-09, CLN-12); a signed one opened by anyone but its
 * consultant is logged as a record view. Undefined when there is none.
 */
export async function loadConsultation(
  actor: StaffMember,
  consultationId: string,
): Promise<ConsultationView | undefined> {
  const writes = can(actor, 'consultant_records.write');
  const reads = can(actor, 'clinical.read');
  if (!writes && !reads) throw new NotAllowedError();
  if (!z.guid().safeParse(consultationId).success) return undefined;
  const read = await asStaffViewing(actor, async (tx) => {
    const found = await consultationRecord(tx, consultationId);
    const own = found?.physioId === actor.id && writes;
    if (!found || !(own || (found.status === 'signed' && reads))) return undefined;
    const sections = consultationSectionsSchema.parse(found.sections);
    const context = await recordContext(tx, found, own ? actor.name : (found.signedByName ?? ''));
    // Read at another centre, the plan's treating physio is not among that centre's physios.
    const treating = sections.plan.treatingPhysioId;
    if (treating && !context.treatingPhysios.some((physio) => physio.id === treating)) {
      context.treatingPhysios.push({
        id: treating,
        name: (await recordStaffName(tx, treating)) ?? '',
      });
    }
    const signed = found.status === 'signed';
    if (signed && !own) await logClinicalView(tx, 'consultation', found.id);
    return {
      found,
      own,
      sections,
      context,
      addenda: signed ? await consultationAddenda(tx, found.id) : [],
    };
  });
  if (!read) return undefined;
  const signed = read.found.status === 'signed';
  return {
    ...read.found,
    ...read.context,
    sections: read.sections,
    assessmentSettings: await assessmentSettings(),
    editable: read.own && !signed,
    addenda: read.addenda,
    // As addendum_add allows: the Treats patients tick, at the episode's centre or on their own.
    addsAddenda:
      signed &&
      actor.treatsPatients &&
      !actor.support &&
      (read.own || worksAtCentre(actor, read.found.centreId)),
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

export const signConsultationSchema = z.object({
  consultationId: z.guid(),
  baseVersion: recordVersionSchema,
});

/**
 * Signs the person's own draft at the version they saw (CLN-09, PRD J3.9): the Treats patients
 * tick read now, every gate passed on the server, everything it names still in its knowledge
 * base version; then the record's rows are written and the visit completed, in one transaction.
 * The episode moves on to Plan proposed (BIL-01; `docs/runbooks/episodes.md`), unless a red flag
 * has put it On hold.
 */
export const signConsultationService = staffService({
  action: 'consultant_records.sign',
  input: signConsultationSchema,
  run: async (tx, input, actor): Promise<{ status: 'signed' }> => {
    const found = await consultationRecord(tx, input.consultationId);
    if (!found || found.physioId !== actor.id) {
      throw new ConsultationError('That consultation was not found.', 'not_found');
    }
    if (found.status === 'signed') {
      throw new ConsultationError('This consultation is signed. Changes are addenda.', 'signed');
    }
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new ConsultationError('Signing needs the Treats patients tick.', 'refused');
    }
    if (found.version !== input.baseVersion) {
      throw new ConsultationError('Your latest changes are still saving. Try again.', 'stale');
    }
    const context = await recordContext(tx, found, actor.name);
    const sections = consultationSectionsSchema.parse(found.sections);
    const reasons = [
      ...signingBlockers(sections, context.patientAnswers, {
        planCatalog: context.planCatalog,
        specialTests: context.objectiveCatalog.specialTests,
      }).map((blocker) => blocker.reason),
    ];
    const { problems, rows } = signedRecord(sections, {
      ...context,
      treatingPhysioIds: context.treatingPhysios.map((physio) => physio.id),
    });
    reasons.push(...problems);
    if (reasons.length > 0) throw new ConsultationError(reasons.join(' '), 'refused');
    const signed = await signConsultation(tx, {
      consultationId: found.id,
      baseVersion: input.baseVersion,
      by: actor.id,
      episodeId: found.episodeId,
      appointmentId: found.appointmentId,
      kbVersionId: found.kbVersionId,
      rows,
    });
    if (signed === 'stale') {
      throw new ConsultationError('Your latest changes are still saving. Try again.', 'stale');
    }
    const episode = await episodeRecord(tx, found.episodeId);
    if (episode && episodeTransition(episode, 'propose_plan').ok) {
      await changeEpisodeStatus(tx, found.episodeId, 'propose_plan');
    }
    return { status: 'signed' };
  },
});

/** Adds an addendum to a signed consultation (CLN-09): clinicians with the tick, at its centre. */
export const addAddendumService = staffService({
  action: 'clinical.read',
  input: addendumSchema,
  run: async (tx, input, actor): Promise<{ id: string }> => {
    const found = await consultationRecord(tx, input.consultationId);
    if (!found) throw new ConsultationError('That consultation was not found.', 'not_found');
    if (found.status !== 'signed') {
      throw new ConsultationError('Addenda are added once the consultation is signed.', 'refused');
    }
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new ConsultationError('Adding an addendum needs the Treats patients tick.', 'refused');
    }
    return addAddendum(tx, {
      consultationId: found.id,
      episodeId: found.episodeId,
      text: input.text,
      authorId: actor.id,
    });
  },
});
