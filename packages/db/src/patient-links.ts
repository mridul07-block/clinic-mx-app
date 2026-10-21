import { createHmac, timingSafeEqual } from 'node:crypto';
import { patientLinkPurposes, type PatientLinkPurpose } from '@clinic-mx/schemas';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { patientActor, setAuditContext } from './audit';
import type { Db } from './client';
import { patientLink, type PatientLink } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Patient links (IAM-09): the signed token and the `patient_link` rows behind it.
 *
 * A token is base64url(payload ‖ mac): payload = version (1 byte) ‖ link id (16) ‖ purpose (1) ‖
 * expiry in epoch seconds (4); mac = the first 16 bytes of HMAC-SHA256 over a domain tag and the
 * payload, keyed with PATIENT_LINK_SECRET. Only the id is stored, so the table alone cannot make
 * a link; a forged or changed token is refused before the database is asked anything.
 */

const VERSION = 1;
const DOMAIN = 'clinic-mx/patient-link/v1';
const PAYLOAD_BYTES = 22;
const MAC_BYTES = 16;

/** The keys links are signed with: the current one, and the one before it while it rotates. */
export interface PatientLinkKeys {
  current: string;
  previous?: string;
}

/** What a token says, once its signature is checked. */
export interface PatientLinkClaim {
  linkId: string;
  purpose: PatientLinkPurpose;
  expiresAt: Date;
}

const mac = (secret: string, payload: Buffer) =>
  createHmac('sha256', secret).update(DOMAIN).update(payload).digest().subarray(0, MAC_BYTES);

/** The token for a link. Expiry is kept to the second. */
export function signPatientLink(claim: PatientLinkClaim, secret: string): string {
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload.writeUInt8(VERSION, 0);
  Buffer.from(claim.linkId.replaceAll('-', ''), 'hex').copy(payload, 1);
  payload.writeUInt8(patientLinkPurposes.indexOf(claim.purpose), 17);
  payload.writeUInt32BE(Math.floor(claim.expiresAt.getTime() / 1000), 18);
  return Buffer.concat([payload, mac(secret, payload)]).toString('base64url');
}

const uuidFrom = (bytes: Buffer) => {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * What a token says if one of the keys signed it, or null for anything else: a changed byte,
 * another key, the wrong length or version. Expiry is the caller's to check (the page says
 * "expired", not "not valid").
 */
export function readPatientLink(token: string, keys: PatientLinkKeys): PatientLinkClaim | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  // One spelling per token: the last character's spare bits must be zero, as signing makes them.
  if (bytes.length !== PAYLOAD_BYTES + MAC_BYTES || bytes.toString('base64url') !== token) {
    return null;
  }
  const payload = bytes.subarray(0, PAYLOAD_BYTES);
  const given = bytes.subarray(PAYLOAD_BYTES);
  const signed = [keys.current, keys.previous].some(
    (secret) => secret !== undefined && timingSafeEqual(mac(secret, payload), given),
  );
  if (!signed || payload.readUInt8(0) !== VERSION) return null;
  const purpose = patientLinkPurposes[payload.readUInt8(17)];
  if (!purpose) return null;
  return {
    linkId: uuidFrom(payload.subarray(1, 17)),
    purpose,
    expiresAt: new Date(payload.readUInt32BE(18) * 1000),
  };
}

export interface NewPatientLink {
  patientId: string;
  purpose: PatientLinkPurpose;
  appointmentId?: string;
  episodeId?: string;
  expiresAt: Date;
}

/** Records a link; its expiry is kept to the second, as the token carries it. */
export async function insertPatientLink(
  db: DbOrTransaction,
  link: NewPatientLink,
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Math.floor(link.expiresAt.getTime() / 1000) * 1000);
  const [row] = await db
    .insert(patientLink)
    .values({
      patientId: link.patientId,
      purpose: link.purpose,
      appointmentId: link.appointmentId ?? null,
      episodeId: link.episodeId ?? null,
      expiresAt,
    })
    .returning({ id: patientLink.id, expiresAt: patientLink.expiresAt });
  if (!row) throw new Error('The patient link was not recorded.');
  return row;
}

/**
 * Stops a patient's My plan links that still work, except `keep` (decision 22 October 2026:
 * only the newest works). Returns how many stopped.
 */
export async function revokeMyPlanLinks(
  db: DbOrTransaction,
  patientId: string,
  keep?: string,
): Promise<number> {
  const stopped = await db
    .update(patientLink)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(patientLink.patientId, patientId),
        eq(patientLink.purpose, 'my_plan'),
        isNull(patientLink.revokedAt),
        gt(patientLink.expiresAt, sql`now()`),
        keep ? ne(patientLink.id, keep) : undefined,
      ),
    )
    .returning({ id: patientLink.id });
  return stopped.length;
}

/** One link by id. */
export async function findPatientLink(
  db: DbOrTransaction,
  id: string,
): Promise<PatientLink | undefined> {
  const [row] = await db.select().from(patientLink).where(eq(patientLink.id, id)).limit(1);
  return row;
}

/** Marks a link submitted, if it still works; false when it had expired, stopped or was used. */
export async function completePatientLinkRow(db: DbOrTransaction, id: string): Promise<boolean> {
  const done = await db
    .update(patientLink)
    .set({ completedAt: sql`now()` })
    .where(
      and(
        eq(patientLink.id, id),
        isNull(patientLink.completedAt),
        isNull(patientLink.revokedAt),
        gt(patientLink.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: patientLink.id });
  return done.length > 0;
}

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The link a patient page runs under. */
export interface PatientLinkAccess {
  id: string;
  patientId: string;
  purpose: PatientLinkPurpose;
}

/**
 * Runs reads for a patient page under row level security (IAM-09, rule 10): one transaction as
 * the `clinic_patient` role with the link in its claims, and the patient as the audit actor.
 * Policies `TO clinic_patient` show only rows that link reaches.
 */
export async function withPatientAccess<R>(
  db: Db,
  { link, ip }: { link: PatientLinkAccess; ip?: string },
  work: (tx: Transaction) => Promise<R>,
): Promise<R> {
  return db.transaction(async (tx) => {
    await setAuditContext(tx, { actor: patientActor(link.patientId), ip });
    const claims = JSON.stringify({
      role: 'clinic_patient',
      patient_link: { id: link.id, patient_id: link.patientId, purpose: link.purpose },
    });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role clinic_patient`);
    return work(tx);
  });
}
