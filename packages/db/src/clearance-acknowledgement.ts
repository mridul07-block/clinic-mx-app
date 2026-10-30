import type { AcknowledgedClearance, ConsentSigner } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import type { DbOrTransaction } from './versioned';

/**
 * The patient's clearance acknowledgement (OUT-09; docs/runbooks/sessions.md): each signed Return
 * to training or Return to sport with the three sections its consultant wrote, and when the
 * patient acknowledged it, read through the database's own functions
 * (`internal.clearance_ack_core`) for the patient's clearance link or for clinicians who see the
 * episode's centre. The acknowledgement is added with `insertConsentRecords` (stage C).
 */

export interface AcknowledgedClearanceRecord {
  status: AcknowledgedClearance;
  signedAt: Date;
  plan: string;
  warningSigns: string;
  residualRisk: string;
  /** When the patient acknowledged all three sections; null until then. */
  acknowledgedAt: Date | null;
  signer: ConsentSigner | null;
}

export interface ClearanceAckContext {
  episodeId: string;
  /** Return to training, then Return to sport, as signed. */
  clearances: AcknowledgedClearanceRecord[];
}

interface Row extends Record<string, unknown> {
  ack: {
    episode_id: string;
    clearances: {
      status: AcknowledgedClearance;
      signed_at: string;
      plan: string;
      warning_signs: string;
      residual_risk: string;
      acknowledged: string | null;
      signer: ConsentSigner | null;
    }[];
  } | null;
}

function context(row: Row | undefined): ClearanceAckContext | undefined {
  const found = row?.ack;
  if (!found) return undefined;
  return {
    episodeId: found.episode_id,
    clearances: found.clearances.map((each) => ({
      status: each.status,
      signedAt: new Date(each.signed_at),
      plan: each.plan,
      warningSigns: each.warning_signs,
      residualRisk: each.residual_risk,
      acknowledgedAt: each.acknowledged ? new Date(each.acknowledged) : null,
      signer: each.signer,
    })),
  };
}

/** The acknowledgements of the patient's own clearance link, inside `withPatientAccess`. */
export async function clearanceAckForLink(
  db: DbOrTransaction,
): Promise<ClearanceAckContext | undefined> {
  const [row] = await db.execute<Row>(sql`select internal.clearance_ack_for_link() as ack`);
  return context(row);
}

/** An episode's acknowledgements, for clinicians who see its centre; undefined otherwise. */
export async function clearanceAckForEpisode(
  db: DbOrTransaction,
  episodeId: string,
): Promise<ClearanceAckContext | undefined> {
  const [row] = await db.execute<Row>(
    sql`select internal.clearance_ack_for_episode(${episodeId}::uuid) as ack`,
  );
  return context(row);
}

/**
 * The clearance still to acknowledge: the newest signed one, until the patient acknowledges it. A
 * newer clearance supersedes an older one's acknowledgement (DECISION OUT-09): a patient cleared
 * for sport is not then asked to accept the training plan before it.
 */
export function clearanceToAcknowledge(
  found: ClearanceAckContext,
): AcknowledgedClearanceRecord | undefined {
  const newest = found.clearances.at(-1);
  return newest?.acknowledgedAt === null ? newest : undefined;
}
