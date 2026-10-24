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

/** The record's clinical part for a clinician; undefined for anyone else. */
export async function clinicalRecordOf(
  actor: StaffMember,
  patientId: string,
  now: Date = new Date(),
): Promise<ClinicalRecord | undefined> {
  if (!can(actor, 'clinical.read')) return undefined;
  return asStaffViewing(actor, async (tx) => {
    const episodes = await episodesOf(tx, patientId);
    const notes = (await signedNotesOf(tx, patientId)).map((note) => ({
      ...note,
      addsAddenda:
        actor.treatsPatients &&
        !actor.support &&
        (note.signedBy === actor.id || worksAtCentre(actor, note.centreId)),
    }));
    const alerts = await patientAlertHistory(tx, patientId);
    const episode = currentEpisode(episodes);
    const summary: PatientSummary | undefined = episode && {
      episode,
      plan: await episodePlan(tx, episode.id),
      precautions: await episodePrecautions(tx, episode.id),
      lastNote: notes.find((note) => note.episodeId === episode.id),
      openAlerts: alerts.filter(
        (alert) => alert.episodeId === episode.id && alert.status !== 'closed',
      ).length,
    };
    const nextVisit = await nextVisitOf(tx, patientId, now);
    await logClinicalView(tx, 'patient', patientId);
    return { summary, notes, alerts, nextVisit };
  });
}
