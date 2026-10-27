import { desc, eq, sql } from 'drizzle-orm';
import { centre, openingEntry, patient, patientPackage } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Opening entries (SCH-13; docs/runbooks/opening-entries.md): patients already in treatment on
 * launch day. Row level security and `internal.opening_entry_guard` hold who writes them, when and
 * what; `internal.opening_package` makes and corrects the opening package.
 */

export interface OpeningEntryRow {
  id: string;
  patientId: string;
  patientName: string;
  opNumber: string;
  episodeId: string;
  centreId: string;
  centreName: string;
  physioId: string;
  physioName: string;
  sessionsLeft: number;
  validUntil: string;
  /** The opening package's sessions used since launch; null if it cannot be read. */
  sessionsUsed: number | null;
  createdAt: Date;
}

export async function insertOpeningEntry(
  tx: DbOrTransaction,
  values: {
    patientId: string;
    episodeId: string;
    centreId: string;
    physioId: string;
    sessionsLeft: number;
    validUntil: string;
    by: string;
  },
): Promise<string> {
  const { by, ...entry } = values;
  const [row] = await tx
    .insert(openingEntry)
    .values({ ...entry, createdBy: by, updatedBy: by })
    .returning({ id: openingEntry.id });
  if (!row) throw new Error('The opening entry was not recorded.');
  return row.id;
}

/** Corrects an entry's physio, sessions left and expiry; false when it was not found. */
export async function correctOpeningEntry(
  tx: DbOrTransaction,
  entryId: string,
  values: { physioId: string; sessionsLeft: number; validUntil: string; by: string },
): Promise<boolean> {
  const { by, ...changes } = values;
  const rows = await tx
    .update(openingEntry)
    .set({ ...changes, updatedBy: by })
    .where(eq(openingEntry.id, entryId))
    .returning({ id: openingEntry.id });
  return rows.length > 0;
}

const columns = {
  id: openingEntry.id,
  patientId: openingEntry.patientId,
  patientName: patient.name,
  opNumber: patient.opNumber,
  episodeId: openingEntry.episodeId,
  centreId: openingEntry.centreId,
  centreName: centre.name,
  physioId: openingEntry.physioId,
  // Through an internal function: whoever reads the entry reads the physio's name.
  physioName: sql<string>`coalesce(internal.record_staff_name(${openingEntry.physioId}), '')`,
  sessionsLeft: openingEntry.sessionsLeft,
  validUntil: openingEntry.validUntil,
  sessionsUsed: patientPackage.sessionsUsed,
  createdAt: openingEntry.createdAt,
};

/** Every opening entry the reader may see, newest first. */
export function openingEntries(db: DbOrTransaction): Promise<OpeningEntryRow[]> {
  return db
    .select(columns)
    .from(openingEntry)
    .innerJoin(patient, eq(patient.id, openingEntry.patientId))
    .innerJoin(centre, eq(centre.id, openingEntry.centreId))
    .leftJoin(patientPackage, eq(patientPackage.openingEntryId, openingEntry.id))
    .orderBy(desc(openingEntry.createdAt));
}

/** The patient's opening entry, if they were entered at launch. */
export async function openingEntryOf(
  db: DbOrTransaction,
  patientId: string,
): Promise<OpeningEntryRow | undefined> {
  const [row] = await db
    .select(columns)
    .from(openingEntry)
    .innerJoin(patient, eq(patient.id, openingEntry.patientId))
    .innerJoin(centre, eq(centre.id, openingEntry.centreId))
    .leftJoin(patientPackage, eq(patientPackage.openingEntryId, openingEntry.id))
    .where(eq(openingEntry.patientId, patientId));
  return row;
}
