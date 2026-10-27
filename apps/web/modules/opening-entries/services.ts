import 'server-only';
import {
  centreList,
  correctOpeningEntry,
  insertEpisode,
  insertOpeningEntry,
  insertPatient,
  openingEntries,
  patientsOnPhone,
  setting,
  staffActor,
  treatingPhysios,
  updateEpisodeState,
  type DbOrTransaction,
  type OpeningEntryRow,
  type PatientMatch,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  openingEntriesSwitchSchema,
  openingEntryCorrectionSchema,
  openingEntrySchema,
  type EpisodeStatus,
} from '@clinic-mx/schemas';
import { eq } from 'drizzle-orm';
import { NotAllowedError } from '../access/guard';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * Opening entries (SCH-13, PRD section 3 phase 5 and section 10; user decisions 27 October 2026;
 * docs/runbooks/opening-entries.md). While entries are open the Super Admin enters a patient
 * already in treatment: the patient (a mobile on file lists its patients first, as Add patient),
 * an episode at the centre walked to Active, and the entry, from which the database makes the
 * opening package with the sessions left and expiry. A correction changes the physio, sessions
 * left or expiry until the package is first used. The database holds the same rules
 * (`internal.opening_entry_guard`).
 */

export class OpeningEntryError extends Error {
  override name = 'OpeningEntryError';
}

export type OpeningEntryResult =
  | { status: 'added'; patientId: string; opNumber: string }
  /** The mobile is on file: nothing was added; open one of these or confirm a new person. */
  | { status: 'matches'; matches: PatientMatch[] };

// An opening entry's episode is Active from the start: walked through the usual states.
const toActive: EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
];

async function open() {
  if (!(await getSetting('launch.opening_entries_open'))) {
    throw new OpeningEntryError('Opening entries are closed.');
  }
}

async function physioAt(tx: DbOrTransaction, physioId: string, centreId: string) {
  if (!(await treatingPhysios(tx, centreId)).some((physio) => physio.id === physioId)) {
    throw new OpeningEntryError('Choose a physio who treats patients at that centre.');
  }
}

/** Enters a patient already in treatment, with an Active episode and the opening package. */
export const createOpeningEntry = staffService({
  action: 'opening_entries.manage',
  input: openingEntrySchema,
  run: async (tx, input, actor): Promise<OpeningEntryResult> => {
    await open();
    await physioAt(tx, input.physioId, input.centreId);
    if (!input.confirmNewPerson) {
      const matches = await patientsOnPhone(tx, input.phone);
      if (matches.length > 0) return { status: 'matches', matches };
    }
    const added = await insertPatient(tx, {
      name: input.name,
      phone: input.phone,
      registeredCentreId: input.centreId,
    });
    const episodeId = await insertEpisode(tx, { patientId: added.id, centreId: input.centreId });
    for (let step = 1; step < toActive.length; step++) {
      const moved = await updateEpisodeState(tx, episodeId, toActive[step - 1] as EpisodeStatus, {
        status: toActive[step] as EpisodeStatus,
        pausedFrom: null,
      });
      if (!moved) throw new Error('The opening episode did not become Active.');
    }
    await insertOpeningEntry(tx, {
      patientId: added.id,
      episodeId,
      centreId: input.centreId,
      physioId: input.physioId,
      sessionsLeft: input.sessionsLeft,
      validUntil: input.validUntil,
      by: actor.id,
    });
    return { status: 'added', patientId: added.id, opNumber: added.opNumber };
  },
});

/** Corrects an entry's physio, sessions left or expiry, until its package is first used. */
export const correctOpeningEntryService = staffService({
  action: 'opening_entries.manage',
  input: openingEntryCorrectionSchema,
  run: async (tx, input, actor): Promise<{ status: 'corrected' }> => {
    await open();
    const entry = (await openingEntries(tx)).find((row) => row.id === input.entryId);
    if (!entry) throw new OpeningEntryError('That opening entry was not found.');
    if (entry.sessionsUsed !== 0) {
      throw new OpeningEntryError('The opening package is in use; it is no longer corrected.');
    }
    await physioAt(tx, input.physioId, entry.centreId);
    await correctOpeningEntry(tx, input.entryId, {
      physioId: input.physioId,
      sessionsLeft: input.sessionsLeft,
      validUntil: input.validUntil,
      by: actor.id,
    });
    return { status: 'corrected' };
  },
});

/** Opens or closes opening entries (`launch.opening_entries_open`). */
export const switchOpeningEntries = staffService({
  action: 'opening_entries.manage',
  input: openingEntriesSwitchSchema,
  run: async (tx, input, actor): Promise<{ open: boolean }> => {
    const rows = await tx
      .update(setting)
      .set({ value: input.open, updatedBy: staffActor(actor.id), updatedAt: new Date() })
      .where(eq(setting.key, 'launch.opening_entries_open'))
      .returning({ key: setting.key });
    if (rows.length === 0) throw new Error('launch.opening_entries_open is missing');
    return { open: input.open };
  },
});

export interface OpeningEntriesView {
  open: boolean;
  entries: OpeningEntryRow[];
  centres: { id: string; name: string; physios: { id: string; name: string }[] }[];
}

/** The opening entries page for the Super Admin. */
export async function openingEntriesView(actor: StaffMember): Promise<OpeningEntriesView> {
  if (!can(actor, 'opening_entries.manage')) throw new NotAllowedError();
  const isOpen = await getSetting('launch.opening_entries_open');
  return asStaff(actor, async (tx) => {
    const centres: OpeningEntriesView['centres'] = [];
    for (const { id, name, active } of await centreList(tx)) {
      if (active) centres.push({ id, name, physios: await treatingPhysios(tx, id) });
    }
    return { open: isOpen, entries: await openingEntries(tx), centres };
  });
}
