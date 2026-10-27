import type { DischargeReason, GoalOutcome, PatientSex, ScreeningRegion } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { centreRecord } from './centres';
import { consultationSummaryFacts, type ConsultationSummaryFacts } from './consultation-summary';
import { appointment, consultation, episode, patient, planOfCare, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The discharge report (OUT-11; Frontend Specification section 11; TAD section 9: built from the
 * signed discharge; docs/runbooks/documents.md). The database queues both jobs when an episode with
 * a signed consultation is discharged. Read by the system for the report job, so it reads the
 * tables directly; only the server calls it.
 */

/** The report job's queue kind, keyed `discharge_report:<episode id>`. */
export const DISCHARGE_REPORT_JOB = 'documents.discharge_report';
/** The WhatsApp message with the report; sent once WhatsApp exists. */
export const DISCHARGE_REPORT_MESSAGE_JOB = 'whatsapp.discharge_report';

/** The episode's latest signed consultation; undefined before one. */
async function latestSignedConsultation(db: DbOrTransaction, episodeId: string) {
  const [row] = await db
    .select({ id: consultation.id })
    .from(consultation)
    .where(and(eq(consultation.episodeId, episodeId), eq(consultation.status, 'signed')))
    .orderBy(desc(consultation.signedAt))
    .limit(1);
  return row?.id;
}

/** The goals of the plan as it now stands (its newest version), as the discharge form marks them. */
export async function episodePlanGoals(db: DbOrTransaction, episodeId: string): Promise<string[]> {
  const consultationId = await latestSignedConsultation(db, episodeId);
  if (!consultationId) return [];
  const [plan] = await db
    .select({ goals: planOfCare.goals })
    .from(planOfCare)
    .where(eq(planOfCare.consultationId, consultationId))
    .orderBy(desc(planOfCare.version))
    .limit(1);
  return (plan?.goals ?? []).map((goal) => goal.text.trim()).filter(Boolean);
}

export interface DischargeReportFacts {
  episodeId: string;
  patientId: string;
  centreId: string;
  centre: { name: string; address: string | null; phone: string | null };
  patient: { name: string; opNumber: string; dateOfBirth: string | null; sex: PatientSex | null };
  episode: {
    region: ScreeningRegion | null;
    openedAt: Date;
    closedAt: Date;
    reason: DischargeReason;
    note: string | null;
    goals: { text: string; outcome: GoalOutcome }[];
    ongoingNeeds: string | null;
    recommendations: string | null;
  };
  diagnosis: ConsultationSummaryFacts['diagnosis'];
  /** Who signed the consultation. */
  consultant: string;
  attendance: {
    attended: number;
    firstAttended: Date | null;
    lastAttended: Date | null;
    noShows: number;
    cancelled: number;
  };
  dischargedBy: { name: string; credentials: string | null };
}

/** What the report prints; undefined unless the episode is discharged with a signed consultation. */
export async function dischargeReportFacts(
  db: DbOrTransaction,
  episodeId: string,
): Promise<DischargeReportFacts | undefined> {
  const [found] = await db.select().from(episode).where(eq(episode.id, episodeId));
  if (
    found?.status !== 'discharged' ||
    !found.closedAt ||
    !found.dischargeReason ||
    !found.dischargedBy
  ) {
    return undefined;
  }
  const consultationId = await latestSignedConsultation(db, episodeId);
  const summary = consultationId ? await consultationSummaryFacts(db, consultationId) : undefined;
  const centre = await centreRecord(db, found.centreId);
  const [person] = await db
    .select({
      name: patient.name,
      opNumber: patient.opNumber,
      dateOfBirth: patient.dateOfBirth,
      sex: patient.sex,
    })
    .from(patient)
    .where(eq(patient.id, found.patientId));
  const [discharger] = await db
    .select({ name: staffUser.name, credentials: staffUser.credentials })
    .from(staffUser)
    .where(eq(staffUser.id, found.dischargedBy));
  if (!summary || !centre || !person || !discharger) return undefined;
  const [visits] = await db
    .select({
      attended: sql<number>`count(*) filter (where ${appointment.status} in ('checked_in', 'in_progress', 'completed'))::int`,
      firstAttended: sql<Date | null>`min(${appointment.startsAt}) filter (where ${appointment.status} in ('checked_in', 'in_progress', 'completed'))`,
      lastAttended: sql<Date | null>`max(${appointment.startsAt}) filter (where ${appointment.status} in ('checked_in', 'in_progress', 'completed'))`,
      noShows: sql<number>`count(*) filter (where ${appointment.status} = 'no_show')::int`,
      cancelled: sql<number>`count(*) filter (where ${appointment.status} = 'cancelled')::int`,
    })
    .from(appointment)
    .where(eq(appointment.episodeId, episodeId));
  const date = (value: Date | string | null | undefined) => (value ? new Date(value) : null);
  return {
    episodeId,
    patientId: found.patientId,
    centreId: found.centreId,
    centre: { name: centre.name, address: centre.address, phone: centre.phone },
    patient: person,
    episode: {
      region: found.bodyRegion,
      openedAt: found.openedAt,
      closedAt: found.closedAt,
      reason: found.dischargeReason,
      note: found.dischargeNote,
      goals: found.dischargeGoals ?? [],
      ongoingNeeds: found.dischargeOngoingNeeds,
      recommendations: found.dischargeRecommendations,
    },
    diagnosis: summary.diagnosis,
    consultant: summary.signer.name,
    attendance: {
      attended: visits?.attended ?? 0,
      firstAttended: date(visits?.firstAttended),
      lastAttended: date(visits?.lastAttended),
      noShows: visits?.noShows ?? 0,
      cancelled: visits?.cancelled ?? 0,
    },
    dischargedBy: discharger,
  };
}
