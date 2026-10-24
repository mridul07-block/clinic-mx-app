import type { EpisodeStatus } from './episodes';
import { seesAllCentres, type StaffRole } from './staff';

/**
 * The patient record (CLN-12, Frontend Specification section 6): tabs chosen by `?tab=` so each
 * can be linked. Decisions (user, 24 October 2026): Overview, Notes, Documents and Alerts, the
 * Progress tab joining with the outcome tickets; those who do not read clinical records see
 * Overview only.
 */

export const patientRecordTabs = ['overview', 'notes', 'documents', 'alerts'] as const;

export type PatientRecordTab = (typeof patientRecordTabs)[number];

export const patientRecordTabLabels: Record<PatientRecordTab, string> = {
  overview: 'Overview',
  notes: 'Notes',
  documents: 'Documents',
  alerts: 'Alerts',
};

/** The tab to show: the one asked for when the reader may see it, else Overview. */
export function patientRecordTab(value: string | undefined, clinical: boolean): PatientRecordTab {
  if (!clinical) return 'overview';
  return patientRecordTabs.find((tab) => tab === value) ?? 'overview';
}

const closedStatuses: readonly EpisodeStatus[] = ['discharged', 'lost_to_follow_up'];

/**
 * The episode the summary card is about: the newest one still open, else the newest closed one;
 * undefined without episodes. `episodes` are newest first, as `episodesOf` returns them.
 */
export function currentEpisode<E extends { status: EpisodeStatus }>(
  episodes: readonly E[],
): E | undefined {
  return episodes.find((episode) => !closedStatuses.includes(episode.status)) ?? episodes[0];
}

/** Whether a staff member works at a centre: every centre for the roles that see them all. */
export function worksAtCentre(
  staff: { role: StaffRole; centreIds: readonly string[] },
  centreId: string,
): boolean {
  return seesAllCentres(staff.role) || staff.centreIds.includes(centreId);
}
