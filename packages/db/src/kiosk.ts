import { createHash, randomBytes } from 'node:crypto';
import { patientLinkPurposes, type PatientLinkPurpose } from '@clinic-mx/schemas';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { centre, kioskDevice, staffUser, type KioskDevice } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Clinic tablets in kiosk mode (IAM-10). The tablet holds a random token in a cookie; only its
 * sha256 is stored. Staff functions run under row level security (check in rights, their
 * centres); the tablet's own reads run on the owner connection once its token is found.
 */

/** A new tablet token: 32 random bytes. */
export function newKioskToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the table keeps of a token. */
export function hashKioskToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface NewKioskDevice {
  centreId: string;
  name: string;
  createdBy: string;
  tokenHash: string;
}

/** Records a tablet set up as a centre's kiosk. */
export async function insertKioskDevice(
  db: DbOrTransaction,
  device: NewKioskDevice,
): Promise<{ id: string }> {
  const [row] = await db.insert(kioskDevice).values(device).returning({ id: kioskDevice.id });
  if (!row) throw new Error('The kiosk tablet was not recorded.');
  return row;
}

export type KioskDeviceWithCentre = KioskDevice & { centreName: string };

/** The tablet holding a token, with its centre's name. */
export async function findKioskByToken(
  db: DbOrTransaction,
  token: string,
): Promise<KioskDeviceWithCentre | undefined> {
  const [row] = await db
    .select({ device: kioskDevice, centreName: centre.name })
    .from(kioskDevice)
    .innerJoin(centre, eq(centre.id, kioskDevice.centreId))
    .where(eq(kioskDevice.tokenHash, hashKioskToken(token)))
    .limit(1);
  return row ? { ...row.device, centreName: row.centreName } : undefined;
}

/** One tablet by id. */
export async function findKioskDevice(
  db: DbOrTransaction,
  id: string,
): Promise<KioskDevice | undefined> {
  const [row] = await db.select().from(kioskDevice).where(eq(kioskDevice.id, id)).limit(1);
  return row;
}

export interface KioskDeviceEntry {
  id: string;
  name: string;
  centreId: string;
  centreName: string;
  createdAt: Date;
  createdByName: string | null;
  stoppedAt: Date | null;
  /** A form is on the tablet now. */
  showingForm: boolean;
}

/** The tablets the reader may see: working ones first, then by centre and name. */
export async function kioskDevices(db: DbOrTransaction): Promise<KioskDeviceEntry[]> {
  const rows = await db
    .select({
      id: kioskDevice.id,
      name: kioskDevice.name,
      centreId: kioskDevice.centreId,
      centreName: centre.name,
      createdAt: kioskDevice.createdAt,
      createdByName: staffUser.name,
      stoppedAt: kioskDevice.stoppedAt,
      currentLinkId: kioskDevice.currentLinkId,
    })
    .from(kioskDevice)
    .innerJoin(centre, eq(centre.id, kioskDevice.centreId))
    .leftJoin(staffUser, eq(staffUser.id, kioskDevice.createdBy))
    .orderBy(
      sql`${kioskDevice.stoppedAt} is not null`,
      asc(centre.name),
      asc(kioskDevice.name),
      desc(kioskDevice.createdAt),
    );
  return rows.map(({ currentLinkId, ...row }) => ({ ...row, showingForm: currentLinkId !== null }));
}

/** Puts a form on a working tablet, replacing any other; false when the tablet was stopped. */
export async function sendLinkToKiosk(
  db: DbOrTransaction,
  kioskId: string,
  linkId: string,
): Promise<boolean> {
  const sent = await db
    .update(kioskDevice)
    .set({ currentLinkId: linkId, currentSince: sql`now()` })
    .where(and(eq(kioskDevice.id, kioskId), isNull(kioskDevice.stoppedAt)))
    .returning({ id: kioskDevice.id });
  return sent.length > 0;
}

/**
 * Takes a form off the tablet, only while it is still that form: a reset never drops a form the
 * front desk sent a moment later. False when there was nothing to take off.
 */
export async function clearKioskLink(
  db: DbOrTransaction,
  kioskId: string,
  linkId: string,
): Promise<boolean> {
  const cleared = await db
    .update(kioskDevice)
    .set({ currentLinkId: null, currentSince: null })
    .where(and(eq(kioskDevice.id, kioskId), eq(kioskDevice.currentLinkId, linkId)))
    .returning({ id: kioskDevice.id });
  return cleared.length > 0;
}

/** Ends a tablet's kiosk mode; false when it had already stopped. */
export async function stopKioskDevice(
  db: DbOrTransaction,
  kioskId: string,
  stoppedBy: string,
): Promise<boolean> {
  const stopped = await db
    .update(kioskDevice)
    .set({ stoppedAt: sql`now()`, stoppedBy, currentLinkId: null, currentSince: null })
    .where(and(eq(kioskDevice.id, kioskId), isNull(kioskDevice.stoppedAt)))
    .returning({ id: kioskDevice.id });
  return stopped.length > 0;
}

export type PatientLinkState = 'active' | 'expired' | 'stopped' | 'used';

/**
 * A link's purpose and state, for someone with check in rights sending it to a tablet; never who
 * it is for (`internal.patient_link_state`). Undefined for an unknown link.
 */
export async function patientLinkState(
  db: DbOrTransaction,
  linkId: string,
): Promise<{ purpose: PatientLinkPurpose; state: PatientLinkState } | undefined> {
  const rows = await db.execute<{ purpose: string; state: PatientLinkState }>(
    sql`select purpose, state from internal.patient_link_state(${linkId}::uuid)`,
  );
  const row = rows[0];
  const purpose = patientLinkPurposes.find((known) => known === row?.purpose);
  return row && purpose ? { purpose, state: row.state } : undefined;
}
