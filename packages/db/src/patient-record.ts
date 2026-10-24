import type {
  AlertDisplay,
  InterventionKind,
  Irritability,
  RedFlagAlertStatus,
  RedFlagTriage,
  Stage,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AddendumEntry } from './clinical-record';
import {
  addendum,
  appointment,
  appointmentType,
  consultation,
  diagnosis,
  episode,
  kbCondition,
  kbModality,
  planModality,
  planOfCare,
  precaution,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The patient record (CLN-12): signed notes, the plan, precautions and red flag alerts of a
 * patient, read by clinicians at any centre (kickoff decision C1). Run under row level security
 * as the reader: consultations and their rows through `internal.reads_consultation`, alerts
 * through `internal.patient_alert_history`, names through `internal.record_staff_name` and
 * `internal.record_centre_name`. Anyone else reads none of it.
 */

export interface SignedNoteEntry {
  id: string;
  episodeId: string;
  centreId: string;
  centreName: string | null;
  signedAt: Date;
  /** Its consultant, who signed it. */
  signedBy: string | null;
  signedByName: string | null;
  /** The working diagnosis signed with it (CLN-06), with the condition's name at its version. */
  diagnosis: {
    conditionId: string;
    conditionName: string | null;
    movementDx: string;
    irritability: Irritability;
    stage: Stage;
    provisional: boolean;
  } | null;
  addenda: AddendumEntry[];
}

/** A patient's signed consultations, newest first, each with its diagnosis and addenda. */
export async function signedNotesOf(
  db: DbOrTransaction,
  patientId: string,
): Promise<SignedNoteEntry[]> {
  const rows = await db
    .select({
      id: consultation.id,
      episodeId: consultation.episodeId,
      centreId: episode.centreId,
      centreName: sql<string | null>`internal.record_centre_name(${episode.centreId})`,
      signedAt: consultation.signedAt,
      signedBy: consultation.signedBy,
      signedByName: sql<string | null>`internal.record_staff_name(${consultation.signedBy})`,
      conditionId: diagnosis.conditionId,
      conditionName: kbCondition.name,
      movementDx: diagnosis.movementDx,
      irritability: diagnosis.irritability,
      stage: diagnosis.stage,
      provisional: diagnosis.provisional,
    })
    .from(consultation)
    .innerJoin(episode, eq(episode.id, consultation.episodeId))
    .leftJoin(diagnosis, eq(diagnosis.consultationId, consultation.id))
    .leftJoin(
      kbCondition,
      and(
        eq(kbCondition.kbVersionId, diagnosis.kbVersionId),
        eq(kbCondition.conditionId, diagnosis.conditionId),
      ),
    )
    .where(and(eq(episode.patientId, patientId), eq(consultation.status, 'signed')))
    .orderBy(desc(consultation.signedAt), asc(consultation.id));
  const addenda = await addendaOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map(
    ({ conditionId, conditionName, movementDx, irritability, stage, provisional, ...note }) => ({
      ...note,
      // Signed, so signed_at is set (check consultation_signed).
      signedAt: note.signedAt ?? new Date(0),
      diagnosis:
        conditionId && movementDx !== null && irritability && stage && provisional !== null
          ? { conditionId, conditionName, movementDx, irritability, stage, provisional }
          : null,
      addenda: addenda.get(note.id) ?? [],
    }),
  );
}

/** The addenda of these consultations, oldest first, by consultation. */
async function addendaOf(
  db: DbOrTransaction,
  consultationIds: string[],
): Promise<Map<string, AddendumEntry[]>> {
  const byConsultation = new Map<string, AddendumEntry[]>();
  if (consultationIds.length === 0) return byConsultation;
  const rows = await db
    .select({
      consultationId: addendum.consultationId,
      id: addendum.id,
      text: addendum.text,
      authorId: addendum.authorId,
      authorName: sql<string>`coalesce(internal.record_staff_name(${addendum.authorId}), '')`,
      createdAt: addendum.createdAt,
    })
    .from(addendum)
    .where(inArray(addendum.consultationId, consultationIds))
    .orderBy(asc(addendum.createdAt), asc(addendum.id));
  for (const { consultationId, ...entry } of rows) {
    byConsultation.set(consultationId, [...(byConsultation.get(consultationId) ?? []), entry]);
  }
  return byConsultation;
}

export interface EpisodePlanEntry {
  consultationId: string;
  version: number;
  goals: { text: string; patient: boolean }[];
  interventions: InterventionKind[];
  sessionsPerWeek: number | null;
  weeks: number | null;
  homeExercises: number;
  reviewDate: string;
  treatingPhysioName: string | null;
  /** Modality names at the knowledge base version the plan was signed with. */
  modalities: string[];
}

/** An episode's newest plan of care (CLN-07, written at signing), or undefined. */
export async function episodePlan(
  db: DbOrTransaction,
  episodeId: string,
): Promise<EpisodePlanEntry | undefined> {
  const [plan] = await db
    .select({
      id: planOfCare.id,
      consultationId: planOfCare.consultationId,
      kbVersionId: consultation.kbVersionId,
      version: planOfCare.version,
      goals: planOfCare.goals,
      interventions: planOfCare.interventions,
      sessionsPerWeek: planOfCare.sessionsPerWeek,
      weeks: planOfCare.weeks,
      homeProgramme: planOfCare.homeProgramme,
      reviewDate: planOfCare.reviewDate,
      treatingPhysioName: sql<
        string | null
      >`internal.record_staff_name(${planOfCare.treatingPhysioId})`,
    })
    .from(planOfCare)
    .innerJoin(consultation, eq(consultation.id, planOfCare.consultationId))
    .where(eq(planOfCare.episodeId, episodeId))
    .orderBy(desc(planOfCare.version))
    .limit(1);
  if (!plan) return undefined;
  const modalities = await db
    .select({ name: sql<string>`coalesce(${kbModality.name}, ${planModality.modalityKey})` })
    .from(planModality)
    .leftJoin(
      kbModality,
      and(
        eq(kbModality.kbVersionId, plan.kbVersionId),
        eq(kbModality.key, planModality.modalityKey),
      ),
    )
    .where(eq(planModality.planOfCareId, plan.id))
    .orderBy(asc(kbModality.sort), asc(planModality.modalityKey));
  return {
    consultationId: plan.consultationId,
    version: plan.version,
    goals: plan.goals,
    interventions: plan.interventions,
    sessionsPerWeek: plan.sessionsPerWeek,
    weeks: plan.weeks,
    homeExercises: plan.homeProgramme.length,
    reviewDate: plan.reviewDate,
    treatingPhysioName: plan.treatingPhysioName,
    modalities: modalities.map((modality) => modality.name),
  };
}

/** The precautions ticked on an episode's health check (INT-08), in the order recorded. */
export function episodePrecautions(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ key: string; label: string }[]> {
  return db
    .select({ key: precaution.key, label: precaution.label })
    .from(precaution)
    .where(eq(precaution.episodeId, episodeId))
    .orderBy(asc(precaution.createdAt), asc(precaution.key));
}

export interface AlertHistoryEntry {
  id: string;
  episodeId: string;
  centreId: string;
  name: string;
  triage: RedFlagTriage;
  display: AlertDisplay;
  status: RedFlagAlertStatus;
  raisedAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  referredTo: string | null;
  referredBy: string | null;
  referredAt: Date | null;
  decision: string | null;
  closedBy: string | null;
  closedAt: Date | null;
}

type AlertHistoryRow = Record<
  | 'id'
  | 'episode_id'
  | 'centre_id'
  | 'name'
  | 'triage'
  | 'display'
  | 'status'
  | 'reviewed_by'
  | 'referred_to'
  | 'referred_by'
  | 'decision'
  | 'closed_by',
  string | null
> &
  Record<'raised_at' | 'reviewed_at' | 'referred_at' | 'closed_at', string | Date | null>;

const asDate = (value: string | Date | null): Date | null =>
  value === null ? null : new Date(value);

/** A patient's red flag alerts at every centre, newest first; none for non-clinicians. */
export async function patientAlertHistory(
  db: DbOrTransaction,
  patientId: string,
): Promise<AlertHistoryEntry[]> {
  const rows = await db.execute<AlertHistoryRow>(
    sql`select * from internal.patient_alert_history(${patientId}::uuid)`,
  );
  return [...rows].map((row) => ({
    id: row.id ?? '',
    episodeId: row.episode_id ?? '',
    centreId: row.centre_id ?? '',
    name: row.name ?? '',
    triage: row.triage as RedFlagTriage,
    display: row.display as AlertDisplay,
    status: row.status as RedFlagAlertStatus,
    raisedAt: asDate(row.raised_at) ?? new Date(0),
    reviewedBy: row.reviewed_by,
    reviewedAt: asDate(row.reviewed_at),
    referredTo: row.referred_to,
    referredBy: row.referred_by,
    referredAt: asDate(row.referred_at),
    decision: row.decision,
    closedBy: row.closed_by,
    closedAt: asDate(row.closed_at),
  }));
}

export interface NextVisitEntry {
  startsAt: Date;
  typeName: string;
  physioName: string | null;
  centreName: string | null;
}

/** The patient's next Booked or Confirmed visit the reader sees, or undefined. */
export async function nextVisitOf(
  db: DbOrTransaction,
  patientId: string,
  now: Date,
): Promise<NextVisitEntry | undefined> {
  const [row] = await db
    .select({
      startsAt: appointment.startsAt,
      typeName: appointmentType.name,
      physioName: sql<string | null>`internal.record_staff_name(${appointment.physioId})`,
      centreName: sql<string | null>`internal.record_centre_name(${appointment.centreId})`,
    })
    .from(appointment)
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(
      and(
        eq(appointment.patientId, patientId),
        inArray(appointment.status, ['booked', 'confirmed']),
        gte(appointment.startsAt, now),
      ),
    )
    .orderBy(asc(appointment.startsAt))
    .limit(1);
  return row;
}

/**
 * Logs a clinician opening a patient's record or a signed consultation (PRD M16, kickoff decision
 * C1), as the transaction's own staff member (`internal.record_view`).
 */
export async function logClinicalView(
  tx: DbOrTransaction,
  entity: 'patient' | 'consultation',
  entityId: string,
): Promise<void> {
  await tx.execute(sql`select internal.record_view(${entity}, ${entityId}::uuid)`);
}

/** A staff member's name as a clinical record shows it (who treats, signed or wrote). */
export async function recordStaffName(
  db: DbOrTransaction,
  staffId: string,
): Promise<string | null> {
  const [row] = await db.execute<{ name: string | null }>(
    sql`select internal.record_staff_name(${staffId}::uuid) as name`,
  );
  return row?.name ?? null;
}
