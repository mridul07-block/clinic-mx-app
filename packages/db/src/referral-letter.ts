import type {
  HealthFormAnswers,
  KnowledgeMeasure,
  KnowledgeSpecialTest,
  PatientSex,
  RedFlagTriage,
  ReportContentType,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq } from 'drizzle-orm';
import { centreRecord } from './centres';
import { knowledgeAssessment, knowledgeObjective } from './knowledge';
import {
  appointment,
  appointmentType,
  consultation,
  episode,
  intakeResponse,
  patient,
  patientReport,
  redFlagAlert,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/** The referral letter's queue kind (ALT-07), queued by the database when an alert is referred. */
export const REFERRAL_LETTER_JOB = 'documents.referral_letter';
/** The WhatsApp safety advice after a red flag (CLN-11); sent once WhatsApp exists. */
export const RED_FLAG_SAFETY_ADVICE_JOB = 'whatsapp.red_flag_safety_advice';

/**
 * Everything the referral letter prints (ALT-07, Frontend Specification section 11), read by the
 * system for the letter job: the referral, the patient, and the episode's consultation as it stood
 * (or, before any consultation, the health form). The job has no staff claims, so this reads the
 * tables directly; only the server calls it.
 */
export interface ReferralLetterFacts {
  alertId: string;
  patientId: string;
  episodeId: string;
  centreId: string;
  centre: { name: string; address: string | null; phone: string | null };
  patient: { name: string; opNumber: string; dateOfBirth: string | null; sex: PatientSex | null };
  /** The visit the red flag came with: the consultation's, or the health form's. */
  visitStartsAt: Date | null;
  referral: {
    found: string;
    triage: RedFlagTriage;
    referredTo: string;
    reason: string;
    question: string;
    referredAt: Date;
  };
  referrer: { name: string; credentials: string | null };
  /** The consultation's sections as they stood; null before any consultation. */
  sections: unknown;
  answers: HealthFormAnswers;
  objectiveCatalog: { measures: KnowledgeMeasure[]; specialTests: KnowledgeSpecialTest[] };
  /** The working diagnosis's condition, by name, when the consultation has chosen one. */
  conditionName: string | null;
  reports: { contentType: ReportContentType; createdAt: Date }[];
  completedVisits: { startsAt: Date; typeName: string }[];
}

/** The facts of a referred alert's letter; undefined until it is referred. */
export async function referralLetterFacts(
  db: DbOrTransaction,
  alertId: string,
): Promise<ReferralLetterFacts | undefined> {
  const [alert] = await db
    .select({
      episodeId: redFlagAlert.episodeId,
      appointmentId: redFlagAlert.appointmentId,
      name: redFlagAlert.name,
      triage: redFlagAlert.triage,
      status: redFlagAlert.status,
      referredTo: redFlagAlert.referredTo,
      referredBy: redFlagAlert.referredBy,
      referredAt: redFlagAlert.referredAt,
      reason: redFlagAlert.referralReason,
      question: redFlagAlert.referralQuestion,
      patientId: episode.patientId,
      centreId: episode.centreId,
    })
    .from(redFlagAlert)
    .innerJoin(episode, eq(episode.id, redFlagAlert.episodeId))
    .where(eq(redFlagAlert.id, alertId));
  if (
    !alert?.referredTo ||
    !alert.referredBy ||
    !alert.referredAt ||
    !alert.reason ||
    !alert.question ||
    (alert.status !== 'referred' && alert.status !== 'closed')
  ) {
    return undefined;
  }

  const [person] = await db
    .select({
      name: patient.name,
      opNumber: patient.opNumber,
      dateOfBirth: patient.dateOfBirth,
      sex: patient.sex,
    })
    .from(patient)
    .where(eq(patient.id, alert.patientId));
  const centre = await centreRecord(db, alert.centreId);
  const [referrer] = await db
    .select({ name: staffUser.name, credentials: staffUser.credentials })
    .from(staffUser)
    .where(eq(staffUser.id, alert.referredBy));
  if (!person || !centre || !referrer) return undefined;

  // The consultation the red flag came with; else the episode's latest.
  const consultations = db
    .select({
      appointmentId: consultation.appointmentId,
      kbVersionId: consultation.kbVersionId,
      sections: consultation.sections,
    })
    .from(consultation);
  const [ofVisit] = alert.appointmentId
    ? await consultations.where(eq(consultation.appointmentId, alert.appointmentId))
    : [];
  const [found] = ofVisit
    ? [ofVisit]
    : await consultations
        .where(eq(consultation.episodeId, alert.episodeId))
        .orderBy(desc(consultation.createdAt))
        .limit(1);
  const visitId = found?.appointmentId ?? alert.appointmentId;
  const [visit] = visitId
    ? await db
        .select({ startsAt: appointment.startsAt })
        .from(appointment)
        .where(eq(appointment.id, visitId))
    : [];
  const [intake] = visitId
    ? await db
        .select({ answers: intakeResponse.answers, submittedAt: intakeResponse.submittedAt })
        .from(intakeResponse)
        .where(eq(intakeResponse.appointmentId, visitId))
    : [];

  let conditionName: string | null = null;
  const sections = found?.sections ?? null;
  const conditionId =
    sections && typeof sections === 'object'
      ? (sections as { assessment?: { conditionId?: unknown } }).assessment?.conditionId
      : undefined;
  if (found && typeof conditionId === 'string' && conditionId) {
    const catalog = await knowledgeAssessment(db, found.kbVersionId);
    conditionName = catalog.conditions.find((c) => c.conditionId === conditionId)?.name ?? null;
  }

  return {
    alertId,
    patientId: alert.patientId,
    episodeId: alert.episodeId,
    centreId: alert.centreId,
    centre: { name: centre.name, address: centre.address, phone: centre.phone },
    patient: person,
    visitStartsAt: visit?.startsAt ?? null,
    referral: {
      found: alert.name,
      triage: alert.triage,
      referredTo: alert.referredTo,
      reason: alert.reason,
      question: alert.question,
      referredAt: alert.referredAt,
    },
    referrer,
    sections,
    answers: intake?.submittedAt ? intake.answers : {},
    objectiveCatalog: found
      ? await knowledgeObjective(db, found.kbVersionId)
      : { measures: [], specialTests: [] },
    conditionName,
    reports: await db
      .select({ contentType: patientReport.contentType, createdAt: patientReport.createdAt })
      .from(patientReport)
      .where(eq(patientReport.patientId, alert.patientId))
      .orderBy(asc(patientReport.createdAt)),
    completedVisits: await db
      .select({ startsAt: appointment.startsAt, typeName: appointmentType.name })
      .from(appointment)
      .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
      .where(and(eq(appointment.episodeId, alert.episodeId), eq(appointment.status, 'completed')))
      .orderBy(asc(appointment.startsAt)),
  };
}
