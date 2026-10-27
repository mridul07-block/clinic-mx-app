import 'server-only';
import { episodeRecord, previousEpisodes, type StaffMember } from '@clinic-mx/db';
import { can, dischargeReasonLabels, screeningRegionLabels } from '@clinic-mx/schemas';
import { asStaff } from '../access/staff-db';

/** One earlier episode as the panel shows it, in words and ISO times. */
export interface PreviousEpisodeItem {
  id: string;
  region: string | null;
  openedAt: string;
  closedAt: string | null;
  reason: string | null;
  diagnosis: string | null;
}

/**
 * The previous episodes panel of a consultation (SCH-14): the patient's discharged episodes with
 * their diagnosis, which one the current episode recurs from, and whether the reader may link
 * (a consultant with the Treats patients tick, while the episode is open).
 */
export interface RecurrenceView {
  episodeId: string;
  linkedEpisodeId: string | null;
  previous: PreviousEpisodeItem[];
  links: boolean;
}

export async function recurrenceView(
  actor: StaffMember,
  patientId: string,
  episodeId: string,
): Promise<RecurrenceView> {
  return asStaff(actor, async (tx) => {
    const current = await episodeRecord(tx, episodeId);
    return {
      episodeId,
      linkedEpisodeId: current?.linkedEpisodeId ?? null,
      previous: (await previousEpisodes(tx, patientId, episodeId)).map((episode) => ({
        id: episode.id,
        region: episode.bodyRegion ? screeningRegionLabels[episode.bodyRegion] : null,
        openedAt: episode.openedAt.toISOString(),
        closedAt: episode.closedAt?.toISOString() ?? null,
        reason: episode.dischargeReason ? dischargeReasonLabels[episode.dischargeReason] : null,
        diagnosis: episode.diagnosisName,
      })),
      links:
        can(actor, 'consultant_records.write') &&
        actor.treatsPatients &&
        !actor.support &&
        current !== undefined &&
        current.status !== 'discharged',
    };
  });
}
