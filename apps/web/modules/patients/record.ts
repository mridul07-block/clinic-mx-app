import 'server-only';
import {
  episodePlan,
  episodePrecautions,
  episodesOf,
  logClinicalView,
  nextVisitOf,
  patientAlertHistory,
  signedNotesOf,
  type AlertHistoryEntry,
  type EpisodeEntry,
  type EpisodePlanEntry,
  type NextVisitEntry,
  type SignedNoteEntry,
  type DbOrTransaction,
  type StaffMember,
} from '@clinic-mx/db';
import { can, currentEpisode, worksAtCentre } from '@clinic-mx/schemas';
import { asStaffViewing } from '../access/staff-db';

/**
 * The clinical part of the patient record (CLN-12): the summary card, signed notes with their
 * addenda, and the red flag alert history, for clinicians only (`clinical.read`: the Super Admin
 * and staff with the Treats patients tick, never Velyx support), at any centre (kickoff decision
 * C1, user decision 24 October 2026). Each open is logged as a record view. Row level security
 * holds the same: anyone else reads none of it.
 */

export interface RecordNote extends SignedNoteEntry {
  /**
   * Whether the reader may add an addendum, as addendum_add allows: the Treats patients tick, at
   * the episode's centre or on their own note.
   */
  addsAddenda: boolean;
}

export interface PatientSummary {
  episode: EpisodeEntry;
  plan: EpisodePlanEntry | undefined;
  precautions: { key: string; label: string }[];
  /** The episode's newest signed note, whose diagnosis the card shows. */
  lastNote: RecordNote | undefined;
  openAlerts: number;
}

export interface ClinicalRecord {
  summary: PatientSummary | undefined;
  notes: RecordNote[];
  alerts: AlertHistoryEntry[];
  nextVisit: NextVisitEntry | undefined;
}

/** The reader's signed notes of the patient, each with whether they may add an addendum. */
export async function recordNotes(
  tx: DbOrTransaction,
  actor: StaffMember,
  patientId: string,
): Promise<RecordNote[]> {
  return (await signedNotesOf(tx, patientId)).map((note) => ({
    ...note,
    addsAddenda:
      actor.treatsPatients &&
      !actor.support &&
      (note.signedBy === actor.id || worksAtCentre(actor, note.centreId)),
  }));
}

/**
 * The summary card of one episode (CLN-12, SES-02): its plan, precautions, newest signed note and
 * open alerts. Nothing from the consultant's preparation sheet (PRD J5.2: no AI sheet).
 */
export async function episodeSummary(
  tx: DbOrTransaction,
  episode: EpisodeEntry,
  notes: RecordNote[],
  alerts: AlertHistoryEntry[],
): Promise<PatientSummary> {
  return {
    episode,
    plan: await episodePlan(tx, episode.id),
    precautions: await episodePrecautions(tx, episode.id),
    lastNote: notes.find((note) => note.episodeId === episode.id),
    openAlerts: alerts.filter(
      (alert) => alert.episodeId === episode.id && alert.status !== 'closed',
    ).length,
  };
}

/** The record's clinical part for a clinician; undefined for anyone else. */
export async function clinicalRecordOf(
  actor: StaffMember,
  patientId: string,
  now: Date = new Date(),
): Promise<ClinicalRecord | undefined> {
  if (!can(actor, 'clinical.read')) return undefined;
  return asStaffViewing(actor, async (tx) => {
    const episodes = await episodesOf(tx, patientId);
    const notes = await recordNotes(tx, actor, patientId);
    const alerts = await patientAlertHistory(tx, patientId);
    const episode = currentEpisode(episodes);
    const summary = episode && (await episodeSummary(tx, episode, notes, alerts));
    const nextVisit = await nextVisitOf(tx, patientId, now);
    await logClinicalView(tx, 'patient', patientId);
    return { summary, notes, alerts, nextVisit };
  });
}
