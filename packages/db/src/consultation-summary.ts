import type {
  AssessmentCatalog,
  HealthFormAnswers,
  InterventionKind,
  Irritability,
  KnowledgeMeasure,
  KnowledgeSpecialTest,
  PatientSex,
  Stage,
} from '@clinic-mx/schemas';
import { asc, eq } from 'drizzle-orm';
import { centreRecord } from './centres';
import { consultationRecord } from './consultations';
import { knowledgeAssessment, knowledgeObjective, knowledgePlan } from './knowledge';
import {
  addendum,
  diagnosis,
  intakeResponse,
  patient,
  planModality,
  planOfCare,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/** The summary job's queue kind (ALT-06), queued by the database on signing and on an addendum. */
export const CONSULTATION_SUMMARY_JOB = 'documents.consultation_summary';
/** The bundled WhatsApp message (ALT-06), queued on signing; sent once WhatsApp exists. */
export const CONSULTATION_SUMMARY_MESSAGE_JOB = 'whatsapp.consultation_summary';

/**
 * Everything the consultation summary prints (ALT-06), read by the system for the summary job.
 * The job has no staff claims, so this reads the tables directly rather than through the record's
 * row level security helpers; only the server calls it.
 */
export interface ConsultationSummaryFacts {
  consultationId: string;
  patientId: string;
  episodeId: string;
  centreId: string;
  centre: { name: string; address: string | null; phone: string | null };
  centreCode: string;
  patient: { name: string; opNumber: string; dateOfBirth: string | null; sex: PatientSex | null };
  visitStartsAt: Date;
  signedAt: Date;
  signer: { name: string; credentials: string | null };
  /** The consultation's sections as stored; the summary parses them. */
  sections: unknown;
  /** The submitted health form's answers; empty when there was none. */
  answers: HealthFormAnswers;
  objectiveCatalog: { measures: KnowledgeMeasure[]; specialTests: KnowledgeSpecialTest[] };
  diagnosis: {
    conditionName: string;
    movement: string;
    irritability: Irritability;
    stage: Stage;
    provisional: boolean;
    categoryName: string | null;
  };
  plan: {
    goals: { text: string; patient: boolean }[];
    interventions: InterventionKind[];
    modalities: string[];
    sessionsPerWeek: number | null;
    weeks: number | null;
    homeProgramme: { exercise: string; dose: string; note: string }[];
    reviewDate: string;
    investigations: string;
    referral: string;
  };
  addenda: { text: string; authorName: string; createdAt: Date }[];
}

const nameOf = (catalog: AssessmentCatalog, conditionId: string) =>
  catalog.conditions.find((c) => c.conditionId === conditionId)?.name ?? conditionId;

/** The facts of a signed consultation; undefined for a draft or one that is not there. */
export async function consultationSummaryFacts(
  db: DbOrTransaction,
  consultationId: string,
): Promise<ConsultationSummaryFacts | undefined> {
  const found = await consultationRecord(db, consultationId);
  if (!found || found.status !== 'signed' || !found.signedAt || !found.signedBy) return undefined;

  const [person] = await db
    .select({ dateOfBirth: patient.dateOfBirth, sex: patient.sex })
    .from(patient)
    .where(eq(patient.id, found.patientId));
  const centre = await centreRecord(db, found.centreId);
  const [signer] = await db
    .select({ name: staffUser.name, credentials: staffUser.credentials })
    .from(staffUser)
    .where(eq(staffUser.id, found.signedBy));
  const [intake] = await db
    .select({ answers: intakeResponse.answers, submittedAt: intakeResponse.submittedAt })
    .from(intakeResponse)
    .where(eq(intakeResponse.appointmentId, found.appointmentId));
  const [dx] = await db
    .select()
    .from(diagnosis)
    .where(eq(diagnosis.consultationId, consultationId));
  const [plan] = await db
    .select()
    .from(planOfCare)
    .where(eq(planOfCare.consultationId, consultationId))
    .orderBy(asc(planOfCare.version))
    .limit(1);
  if (!person || !centre || !signer || !dx || !plan) return undefined;

  const assessment = await knowledgeAssessment(db, found.kbVersionId);
  const planCatalog = await knowledgePlan(db, found.kbVersionId);
  const modalityKeys = await db
    .select({ key: planModality.modalityKey })
    .from(planModality)
    .where(eq(planModality.planOfCareId, plan.id));
  const notes = await db
    .select({
      text: addendum.text,
      authorName: staffUser.name,
      createdAt: addendum.createdAt,
    })
    .from(addendum)
    .innerJoin(staffUser, eq(staffUser.id, addendum.authorId))
    .where(eq(addendum.consultationId, consultationId))
    .orderBy(asc(addendum.createdAt), asc(addendum.id));

  return {
    consultationId,
    patientId: found.patientId,
    episodeId: found.episodeId,
    centreId: found.centreId,
    centre: { name: centre.name, address: centre.address, phone: centre.phone },
    centreCode: centre.code,
    patient: {
      name: found.patientName,
      opNumber: found.opNumber,
      dateOfBirth: person.dateOfBirth,
      sex: person.sex,
    },
    visitStartsAt: found.startsAt,
    signedAt: found.signedAt,
    signer,
    sections: found.sections,
    answers: intake?.submittedAt ? intake.answers : {},
    objectiveCatalog: await knowledgeObjective(db, found.kbVersionId),
    diagnosis: {
      conditionName: nameOf(assessment, dx.conditionId),
      movement: dx.movementDx,
      irritability: dx.irritability,
      stage: dx.stage,
      provisional: dx.provisional,
      categoryName: dx.categoryCode
        ? (assessment.categories.find((c) => c.code === dx.categoryCode)?.name ?? null)
        : null,
    },
    plan: {
      goals: plan.goals,
      interventions: plan.interventions,
      modalities: modalityKeys.map(
        ({ key }) => planCatalog.modalities.find((m) => m.key === key)?.name ?? key,
      ),
      sessionsPerWeek: plan.sessionsPerWeek,
      weeks: plan.weeks,
      homeProgramme: plan.homeProgramme,
      reviewDate: plan.reviewDate,
      investigations: plan.investigationsAdvised,
      referral: plan.referralAdvised,
    },
    addenda: notes,
  };
}
