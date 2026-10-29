import 'server-only';
import { auditLog, type StaffMember } from '@clinic-mx/db';
import {
  auditLogQuery,
  auditPartsFor,
  auditTablesOf,
  endOfIstDay,
  startOfIstDay,
  type AuditLogEntry,
  type AuditLogQuery,
  type AuditPart,
} from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { asStaff } from '../access/staff-db';

/**
 * The audit log viewer (ADM-01; docs/runbooks/audit.md). The Super Admin reads every event,
 * Centre Managers the clinical events at their centres, Finance the money events
 * (`audit.view_*`); the database decides again which rows and values each reads
 * (`internal.audit_log`), as the person, under row level security. Recommended defaults chosen
 * under the user's standing approval, 29 October 2026 (DECISION ADM-01).
 */

/** Events per page; "Older" goes on from the last. */
export const AUDIT_PAGE_SIZE = 50;

export interface AuditLogPage {
  parts: AuditPart[];
  query: AuditLogQuery;
  entries: AuditLogEntry[];
  /** The id to read older events before, when there are more. */
  older: number | null;
}

export async function readAuditLog(
  staff: StaffMember,
  raw: Record<string, unknown>,
): Promise<AuditLogPage> {
  const parts = auditPartsFor(staff);
  if (!parts.length) throw new NotAllowedError('You cannot read the audit log.');
  const query = auditLogQuery(raw);
  if (query.part && !parts.includes(query.part)) {
    throw new NotAllowedError('You cannot read that part of the audit log.');
  }
  // Only the Super Admin reads setup tables; anyone else filters within their parts' tables.
  if (
    query.entity &&
    !parts.includes('admin') &&
    !parts.some((part) => auditTablesOf(part).includes(query.entity ?? ''))
  ) {
    throw new NotAllowedError('You cannot read that record type in the audit log.');
  }
  const rows = await asStaff(staff, (tx) =>
    auditLog(tx, {
      part: query.part,
      entity: query.entity,
      from: query.from ? startOfIstDay(query.from) : undefined,
      to: query.to ? endOfIstDay(query.to) : undefined,
      before: query.before,
      limit: AUDIT_PAGE_SIZE + 1,
    }),
  );
  const entries = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = entries.at(-1);
  return { parts, query, entries, older: rows.length > AUDIT_PAGE_SIZE && last ? last.id : null };
}
