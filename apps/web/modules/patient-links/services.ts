import 'server-only';
import {
  completePatientLinkRow,
  findPatientLink,
  insertPatientLink,
  logRecordView,
  patientActor,
  readPatientLink,
  revokeMyPlanLinks,
  signPatientLink,
  type DbOrTransaction,
  type PatientLinkAccess,
  type PatientLinkKeys,
} from '@clinic-mx/db';
import {
  patientLinkDefinitions,
  patientLinkExpiry,
  patientLinkPurposes,
  subjectFits,
  type PatientLinkPurpose,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { appDb } from '../../lib/db';
import { serverEnv } from '../../lib/env';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * Patient links (IAM-09, TAD sections 3 and 5): signed, single purpose, expiring links to the
 * patient pages at /p/<token>. Other modules issue them inside their own audited transactions
 * (check in, plan acceptance, messages); WhatsApp reissues My plan links; the patient page opens
 * them. Decisions (user, 22 October 2026): lifetimes are settings; a new My plan link stops the
 * older ones; form links accept one submission.
 */

/** A link that cannot be made as asked, or patient links are not set up. */
export class PatientLinkError extends Error {
  override name = 'PatientLinkError';
}

/** The signing keys, or null when PATIENT_LINK_SECRET is not set (then no link opens). */
function linkKeys(): PatientLinkKeys | null {
  const env = serverEnv();
  if (!env.PATIENT_LINK_SECRET) return null;
  return { current: env.PATIENT_LINK_SECRET, previous: env.PATIENT_LINK_SECRET_PREVIOUS };
}

export const issueLinkSchema = z.object({
  patientId: z.guid(),
  purpose: z.enum(patientLinkPurposes),
  appointmentId: z.guid().optional(),
  episodeId: z.guid().optional(),
});

export interface IssuedLink {
  linkId: string;
  /** The page on our domain, `/p/<token>`; the caller adds the origin. */
  path: string;
  expiresAt: Date;
}

/**
 * Issues a link inside the caller's audited transaction. Its lifetime comes from the purpose's
 * setting; a My plan link stops the patient's older My plan links.
 */
export async function issuePatientLink(
  tx: DbOrTransaction,
  rawInput: z.input<typeof issueLinkSchema>,
): Promise<IssuedLink> {
  const input = issueLinkSchema.parse(rawInput);
  if (!subjectFits(input.purpose, input)) {
    const subject = patientLinkDefinitions[input.purpose].subject;
    throw new PatientLinkError(
      `A ${input.purpose} link is tied to one ${subject === 'either' ? 'appointment or episode' : subject}.`,
    );
  }
  const secret = linkKeys()?.current;
  if (!secret) throw new PatientLinkError('Patient links are not set up (PATIENT_LINK_SECRET).');
  const { setting, unit } = patientLinkDefinitions[input.purpose].lifetime;
  const row = await insertPatientLink(tx, {
    ...input,
    expiresAt: patientLinkExpiry(unit, await getSetting(setting)),
  });
  if (input.purpose === 'my_plan') await revokeMyPlanLinks(tx, input.patientId, row.id);
  const token = signPatientLink(
    { linkId: row.id, purpose: input.purpose, expiresAt: row.expiresAt },
    secret,
  );
  return { linkId: row.id, path: `/p/${token}`, expiresAt: row.expiresAt };
}

/**
 * A new My plan link asked for on WhatsApp (TAD section 5): issued by the system for the patient
 * the webhook identified; their older My plan links stop working.
 */
export const reissueMyPlanLink = systemService({
  component: 'whatsapp',
  input: z.object({ patientId: z.guid(), episodeId: z.guid() }),
  run: (tx, { patientId, episodeId }) =>
    issuePatientLink(tx, { patientId, episodeId, purpose: 'my_plan' }),
});

/**
 * The page of a link already issued, signed again from its row (IAM-10: the clinic tablet opens
 * the form sent to it). Signing is deterministic, so this is the link the patient was given.
 * Null when patient links are not set up.
 */
export function patientLinkPath(link: {
  id: string;
  purpose: PatientLinkPurpose;
  expiresAt: Date;
}): string | null {
  const secret = linkKeys()?.current;
  if (!secret) return null;
  return `/p/${signPatientLink({ linkId: link.id, purpose: link.purpose, expiresAt: link.expiresAt }, secret)}`;
}

/** The link a token names, if its signature holds; expiry not checked. */
export function patientLinkIdFromToken(token: string): string | null {
  const keys = linkKeys();
  return (keys && readPatientLink(token, keys)?.linkId) ?? null;
}

/** Marks a single use link submitted; the form tickets call it inside the submit transaction. */
export async function completePatientLink(
  tx: DbOrTransaction,
  link: { id: string; purpose: PatientLinkPurpose },
): Promise<void> {
  if (!patientLinkDefinitions[link.purpose].singleUse) {
    throw new PatientLinkError('Only single use links are completed.');
  }
  if (!(await completePatientLinkRow(tx, link.id))) {
    throw new PatientLinkError('This link no longer accepts a submission.');
  }
}

/** What opening a link found. */
export type OpenedLink =
  | {
      status: 'valid';
      link: PatientLinkAccess & {
        appointmentId: string | null;
        episodeId: string | null;
        expiresAt: Date;
      };
    }
  | { status: 'expired' | 'revoked' | 'used'; purpose: PatientLinkPurpose }
  | { status: 'invalid' };

/**
 * Opens a patient link: its signature first (a forged or changed token never reaches the
 * database), then its expiry, then the row: stopped, submitted, or valid. A valid open is
 * audited as a view by the patient.
 */
export async function openPatientLink(
  token: string,
  { ip, now = new Date() }: { ip?: string; now?: Date } = {},
): Promise<OpenedLink> {
  const opened = await verifyPatientLink(token, { now });
  if (opened.status === 'valid') {
    await logRecordView(appDb(), {
      actor: patientActor(opened.link.patientId),
      ip,
      entity: 'patient_link',
      entityId: opened.link.id,
    });
  }
  return opened;
}

/**
 * The same checks as opening a link, for a form post (INT-04): the post itself is the audited
 * write, so no view is logged.
 */
export async function verifyPatientLink(
  token: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<OpenedLink> {
  const keys = linkKeys();
  const claim = keys ? readPatientLink(token, keys) : null;
  if (!claim) return { status: 'invalid' };
  if (claim.expiresAt <= now) return { status: 'expired', purpose: claim.purpose };

  const db = appDb();
  const row = await findPatientLink(db, claim.linkId);
  if (
    !row ||
    row.purpose !== claim.purpose ||
    row.expiresAt.getTime() !== claim.expiresAt.getTime()
  ) {
    return { status: 'invalid' };
  }
  if (row.revokedAt) return { status: 'revoked', purpose: row.purpose };
  if (row.expiresAt <= now) return { status: 'expired', purpose: row.purpose };
  if (row.completedAt) return { status: 'used', purpose: row.purpose };
  return {
    status: 'valid',
    link: {
      id: row.id,
      patientId: row.patientId,
      purpose: row.purpose,
      appointmentId: row.appointmentId,
      episodeId: row.episodeId,
      expiresAt: row.expiresAt,
    },
  };
}
