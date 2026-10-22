import type { AppointmentTypeDetails } from '@clinic-mx/schemas';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { appointmentType, physioAppointmentLength } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Appointment types and their lengths (SET-03). Every signed in staff member reads them; the
 * Super Admin changes them. Run under row level security; every change is audited by the trigger.
 */

export interface AppointmentTypeEntry {
  id: string;
  key: string;
  name: string;
  minutes: number;
  active: boolean;
  /** How many physios have their own length for this type. */
  physioLengths: number;
}

const columns = {
  id: appointmentType.id,
  key: appointmentType.key,
  name: appointmentType.name,
  minutes: appointmentType.minutes,
  active: appointmentType.active,
  physioLengths: sql<number>`(
    select count(*)::int from ${physioAppointmentLength}
    where ${physioAppointmentLength.appointmentTypeId} = ${appointmentType.id}
  )`,
};

/** Every appointment type: active ones first, then by name. */
export function appointmentTypeList(db: DbOrTransaction): Promise<AppointmentTypeEntry[]> {
  return db
    .select(columns)
    .from(appointmentType)
    .orderBy(desc(appointmentType.active), asc(appointmentType.name));
}

/** One appointment type, or undefined when it was not found. */
export async function appointmentTypeRecord(
  db: DbOrTransaction,
  appointmentTypeId: string,
): Promise<AppointmentTypeEntry | undefined> {
  const [row] = await db
    .select(columns)
    .from(appointmentType)
    .where(eq(appointmentType.id, appointmentTypeId));
  return row;
}

/** Records a new, active appointment type under its key; returns its id. */
export async function insertAppointmentType(
  db: DbOrTransaction,
  type: AppointmentTypeDetails & { key: string },
): Promise<string> {
  const [row] = await db.insert(appointmentType).values(type).returning({ id: appointmentType.id });
  if (!row) throw new Error('The appointment type was not recorded.');
  return row.id;
}

/** Changes a type's name and length (never its key); false when it was not found. */
export async function updateAppointmentType(
  db: DbOrTransaction,
  appointmentTypeId: string,
  details: AppointmentTypeDetails,
): Promise<boolean> {
  const updated = await db
    .update(appointmentType)
    .set({ ...details, updatedAt: sql`now()` })
    .where(eq(appointmentType.id, appointmentTypeId))
    .returning({ id: appointmentType.id });
  return updated.length > 0;
}

/** Deactivates or reactivates a type; false when it was not found or already so. */
export async function setAppointmentTypeActive(
  db: DbOrTransaction,
  appointmentTypeId: string,
  active: boolean,
): Promise<boolean> {
  const changed = await db
    .update(appointmentType)
    .set({ active, updatedAt: sql`now()` })
    .where(and(eq(appointmentType.id, appointmentTypeId), ne(appointmentType.active, active)))
    .returning({ id: appointmentType.id });
  return changed.length > 0;
}

/** Whether another type already has this name (any case). */
export async function appointmentTypeNameTaken(
  db: DbOrTransaction,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(
      and(
        sql`lower(${appointmentType.name}) = lower(${name})`,
        exceptId ? ne(appointmentType.id, exceptId) : undefined,
      ),
    );
  return Boolean(row);
}

/** Whether a type already has this key. */
export async function appointmentTypeKeyTaken(db: DbOrTransaction, key: string): Promise<boolean> {
  const [row] = await db
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, key));
  return Boolean(row);
}

/** A physio's own lengths, by appointment type id. */
export async function physioLengths(
  db: DbOrTransaction,
  staffUserId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      appointmentTypeId: physioAppointmentLength.appointmentTypeId,
      minutes: physioAppointmentLength.minutes,
    })
    .from(physioAppointmentLength)
    .where(eq(physioAppointmentLength.staffUserId, staffUserId));
  return new Map(rows.map((row) => [row.appointmentTypeId, row.minutes]));
}

/**
 * Sets a physio's own lengths: a number sets it, null clears it back to the type's. Only what
 * changed is written, so the audit shows just that.
 */
export async function setPhysioLengths(
  db: DbOrTransaction,
  staffUserId: string,
  lengths: { appointmentTypeId: string; minutes: number | null }[],
): Promise<void> {
  const current = await physioLengths(db, staffUserId);
  for (const { appointmentTypeId, minutes } of lengths) {
    const had = current.get(appointmentTypeId);
    if (had === (minutes ?? undefined)) continue;
    const row = and(
      eq(physioAppointmentLength.staffUserId, staffUserId),
      eq(physioAppointmentLength.appointmentTypeId, appointmentTypeId),
    );
    if (minutes === null) {
      await db.delete(physioAppointmentLength).where(row);
    } else if (had === undefined) {
      await db.insert(physioAppointmentLength).values({ staffUserId, appointmentTypeId, minutes });
    } else {
      await db.update(physioAppointmentLength).set({ minutes }).where(row);
    }
  }
}

/**
 * How long an appointment of a type takes with a physio: their own length, else the type's.
 * Undefined when the type was not found. The slot engine (SCH-04) books with it.
 */
export async function lengthFor(
  db: DbOrTransaction,
  staffUserId: string,
  appointmentTypeId: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({
      minutes: sql<number>`coalesce(${physioAppointmentLength.minutes}, ${appointmentType.minutes})`,
    })
    .from(appointmentType)
    .leftJoin(
      physioAppointmentLength,
      and(
        eq(physioAppointmentLength.appointmentTypeId, appointmentType.id),
        eq(physioAppointmentLength.staffUserId, staffUserId),
      ),
    )
    .where(eq(appointmentType.id, appointmentTypeId));
  return row?.minutes;
}
