import { auditCategory, type AuditLogEntry, type AuditPart } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import type { DbOrTransaction } from './versioned';

/**
 * The audit log as the transaction's staff member may read it (ADM-01): `internal.audit_log`
 * decides who reads which events and hides a clinical record's values from non-clinicians, so
 * this runs under row level security as the person (`asStaff`).
 */

export interface AuditLogFilters {
  part?: AuditPart;
  entity?: string;
  from?: Date;
  /** Exclusive. */
  to?: Date;
  /** Events older than this one (the previous page's last). */
  before?: number;
  limit: number;
}

interface Row extends Record<string, unknown> {
  id: string | number;
  at: string | Date;
  actor: string;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changed: string[] | null;
  redacted: boolean;
  hidden_fields: string[] | null;
}

export async function auditLog(
  tx: DbOrTransaction,
  { part, entity, from, to, before, limit }: AuditLogFilters,
): Promise<AuditLogEntry[]> {
  const rows = await tx.execute<Row>(sql`
    select * from internal.audit_log(
      ${part ?? null}::text, ${entity ?? null}::text, ${from?.toISOString() ?? null}::timestamptz,
      ${to?.toISOString() ?? null}::timestamptz, ${before ?? null}::bigint, ${limit}::integer)`);
  return rows.map((row) => ({
    id: Number(row.id),
    at: new Date(row.at),
    actor: row.actor,
    actorName: row.actor_name,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    category: auditCategory(row.entity),
    before: row.before,
    after: row.after,
    changed: row.changed,
    redacted: row.redacted,
    hiddenFields: row.hidden_fields ?? [],
  }));
}

/** Records a download of the audit log by the transaction's staff member (ADM-04). */
export async function logAuditDownload(
  tx: DbOrTransaction,
  filters: Record<string, unknown>,
  events: number,
): Promise<void> {
  await tx.execute(
    sql`select internal.log_audit_download(${JSON.stringify(filters)}::jsonb, ${events}::integer)`,
  );
}
