import type { CentreDetails } from '@clinic-mx/schemas';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { centre } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Centres (SET-01): the Super Admin adds, edits and deactivates them; none is ever deleted.
 * Run under row level security: everyone reads the centres they see, only the Super Admin writes
 * (centres.manage). Every change is audited by the trigger.
 */

export interface CentreEntry {
  id: string;
  name: string;
  address: string | null;
  mapLink: string | null;
  phone: string | null;
  colour: string;
  active: boolean;
}

const columns = {
  id: centre.id,
  name: centre.name,
  address: centre.address,
  mapLink: centre.mapLink,
  phone: centre.phone,
  colour: centre.colour,
  active: centre.active,
};

/** Every centre the reader sees: active ones first, then by name. */
export function centreList(db: DbOrTransaction): Promise<CentreEntry[]> {
  return db.select(columns).from(centre).orderBy(desc(centre.active), asc(centre.name));
}

/** One centre, or undefined when the reader cannot see it. */
export async function centreRecord(
  db: DbOrTransaction,
  centreId: string,
): Promise<CentreEntry | undefined> {
  const [row] = await db.select(columns).from(centre).where(eq(centre.id, centreId));
  return row;
}

/** Records a new, active centre; returns its id. */
export async function insertCentre(db: DbOrTransaction, details: CentreDetails): Promise<string> {
  const [row] = await db.insert(centre).values(details).returning({ id: centre.id });
  if (!row) throw new Error('The centre was not recorded.');
  return row.id;
}

/** Changes a centre's details; false when it was not found. */
export async function updateCentre(
  db: DbOrTransaction,
  centreId: string,
  details: CentreDetails,
): Promise<boolean> {
  const updated = await db
    .update(centre)
    .set({ ...details, updatedAt: sql`now()` })
    .where(eq(centre.id, centreId))
    .returning({ id: centre.id });
  return updated.length > 0;
}

/** Deactivates or reactivates a centre; false when it was not found or already so. */
export async function setCentreActive(
  db: DbOrTransaction,
  centreId: string,
  active: boolean,
): Promise<boolean> {
  const changed = await db
    .update(centre)
    .set({ active, updatedAt: sql`now()` })
    .where(and(eq(centre.id, centreId), ne(centre.active, active)))
    .returning({ id: centre.id });
  return changed.length > 0;
}

/** The active centre using a colour, other than `exceptId`, if any. */
export async function activeCentreWithColour(
  db: DbOrTransaction,
  colour: string,
  exceptId?: string,
): Promise<{ id: string; name: string } | undefined> {
  const [row] = await db
    .select({ id: centre.id, name: centre.name })
    .from(centre)
    .where(
      and(
        eq(centre.colour, colour),
        eq(centre.active, true),
        exceptId ? ne(centre.id, exceptId) : undefined,
      ),
    );
  return row;
}

/** Whether another centre already has this name (any case). */
export async function centreNameTaken(
  db: DbOrTransaction,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: centre.id })
    .from(centre)
    .where(
      and(
        sql`lower(${centre.name}) = lower(${name})`,
        exceptId ? ne(centre.id, exceptId) : undefined,
      ),
    );
  return Boolean(row);
}
