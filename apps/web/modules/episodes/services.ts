import 'server-only';
import {
  consultationRecord,
  episodeRecord,
  insertEpisode,
  patientRecord,
  setEpisodeLink,
  updateEpisodeState,
} from '@clinic-mx/db';
import {
  episodeTransition,
  openEpisodeSchema,
  recurrenceLinkSchema,
  worksAtCentre,
  type DischargeDetails,
  type EpisodeEvent,
  type EpisodeState,
} from '@clinic-mx/schemas';
import { staffService, type ServiceTransaction } from '../access/service';

/**
 * Clinical episodes (SCH-03, PRD M1): the backbone every visit, plan and payment belongs to. An
 * episode opens at booking (user decision, 22 October 2026) and moves only through the events of
 * the status machine (packages/schemas/src/episodes.ts); the database trigger refuses anything
 * else, and the audit trail keeps the history. Each later ticket calls `changeEpisodeStatus`
 * from its own service, which checks that ticket's permission: the health form submit (INT-10),
 * signing (CLN), payment (BIL), holds (ALT), review and discharge (OUT).
 */

/** A refusal to show staff as it is. */
export class EpisodeError extends Error {
  override name = 'EpisodeError';
}

/** Opens an episode as Intake pending at a centre the person sees (SCH-07 calls it). */
export const openEpisode = staffService({
  action: 'bookings.manage',
  input: openEpisodeSchema,
  target: (input) => Promise.resolve({ centreId: input.centreId }),
  run: async (tx, input) => {
    if (!(await patientRecord(tx, input.patientId))) {
      throw new EpisodeError('That patient was not found.');
    }
    if (input.linkedEpisodeId) {
      const linked = await episodeRecord(tx, input.linkedEpisodeId);
      if (linked?.patientId !== input.patientId || linked.status !== 'discharged') {
        throw new EpisodeError('A recurrence links to a discharged episode of the same patient.');
      }
    }
    return insertEpisode(tx, input);
  },
});

/**
 * Marks a consultation's episode a recurrence of an earlier, discharged one of the same patient,
 * or removes the mark (SCH-14, PRD J7.5): the consultant's clinical call, made in the consultation
 * while the episode is open, by the consultation's own consultant or a consultant at the episode's
 * centre (as addenda are added). The database refuses anyone else.
 */
export const linkRecurrence = staffService({
  action: 'consultant_records.write',
  input: recurrenceLinkSchema,
  run: async (tx, input, actor): Promise<{ linkedEpisodeId: string | null }> => {
    const found = await consultationRecord(tx, input.consultationId);
    if (!found) throw new EpisodeError('That consultation was not found.');
    const current = await episodeRecord(tx, found.episodeId);
    if (!current) throw new EpisodeError('That episode was not found.');
    if (found.physioId !== actor.id && !worksAtCentre(actor, current.centreId)) {
      throw new EpisodeError(
        'A recurrence is linked by the consultation’s consultant or a consultant at its centre.',
      );
    }
    if (current.status === 'discharged') {
      throw new EpisodeError('A discharged episode never changes.');
    }
    if (!actor.treatsPatients) {
      throw new EpisodeError('Linking a recurrence needs the Treats patients tick.');
    }
    if (input.linkedEpisodeId) {
      const earlier = await episodeRecord(tx, input.linkedEpisodeId);
      if (
        earlier?.patientId !== current.patientId ||
        earlier.status !== 'discharged' ||
        earlier.id === current.id
      ) {
        throw new EpisodeError('A recurrence links to a discharged episode of the same patient.');
      }
    }
    if (!(await setEpisodeLink(tx, current.id, input.linkedEpisodeId))) {
      throw new EpisodeError('That episode was not found.');
    }
    return { linkedEpisodeId: input.linkedEpisodeId };
  },
});

/**
 * Moves an episode by one event inside the caller's service transaction, after the machine's
 * guards; the new state, or an EpisodeError saying why not. Only changes the row if its status is
 * still the one read, so two changes at once cannot both win.
 */
export async function changeEpisodeStatus(
  tx: ServiceTransaction,
  episodeId: string,
  event: EpisodeEvent,
  discharge?: DischargeDetails,
): Promise<EpisodeState> {
  const current = await episodeRecord(tx, episodeId);
  if (!current) throw new EpisodeError('That episode was not found.');
  const result = episodeTransition(current, event, discharge);
  if (!result.ok) throw new EpisodeError(result.refusal);
  if (!(await updateEpisodeState(tx, episodeId, current.status, result.next, discharge))) {
    throw new EpisodeError('The episode changed meanwhile. Reload and try again.');
  }
  return result.next;
}
