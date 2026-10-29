import 'server-only';
import { auditLog, logAuditDownload, type StaffMember } from '@clinic-mx/db';
import {
  auditCsv,
  auditDownloadSpan,
  type AuditDownloadRefusal,
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
import { asStaff, asStaffViewing } from '../access/staff-db';
import { getSetting } from '../settings/settings';

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

/** The filters a person may use, or a refusal: their parts of the trail and those parts' tables. */
function checkedQuery(staff: StaffMember, raw: Record<string, unknown>) {
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
  return { parts, query };
}

export async function readAuditLog(
  staff: StaffMember,
  raw: Record<string, unknown>,
): Promise<AuditLogPage> {
  const { parts, query } = checkedQuery(staff, raw);
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

/** A download that cannot be made as asked, and why (`refusal`). */
export class AuditDownloadError extends Error {
  override name = 'AuditDownloadError';
  constructor(readonly refusal: AuditDownloadRefusal) {
    super(refusal);
  }
}

/** How many events to ask the database for at a time (`internal.audit_log` gives at most 200). */
const DOWNLOAD_PAGE = 200;

/**
 * The events the person may read for the chosen days, part and record type, as a CSV file
 * (ADM-04; PRD section 2 "Audit log and data export"); the download is audited. A span longer than
 * `audit.download_max_days`, or more than `audit.download_max_events` events, is refused, never cut
 * short.
 */
export async function auditLogDownload(
  staff: StaffMember,
  raw: Record<string, unknown>,
): Promise<{ fileName: string; body: string }> {
  const { query } = checkedQuery(staff, raw);
  const [maxDays, maxEvents] = await Promise.all([
    getSetting('audit.download_max_days'),
    getSetting('audit.download_max_events'),
  ]);
  const span = auditDownloadSpan(query, maxDays);
  if (!span.ok) throw new AuditDownloadError(span.refusal);
  return asStaffViewing(staff, async (tx) => {
    const entries: AuditLogEntry[] = [];
    let before: number | undefined;
    for (;;) {
      const page = await auditLog(tx, {
        part: query.part,
        entity: query.entity,
        from: startOfIstDay(span.from),
        to: endOfIstDay(span.to),
        before,
        limit: DOWNLOAD_PAGE,
      });
      entries.push(...page);
      if (entries.length > maxEvents) throw new AuditDownloadError('too_many');
      // Only an empty page ends it: a short one may be the database's own cap.
      const last = page.at(-1);
      if (!last) break;
      before = last.id;
    }
    const filters = { part: query.part, entity: query.entity, from: span.from, to: span.to };
    await logAuditDownload(tx, filters, entries.length);
    return {
      fileName: ['clinic-mx-audit', span.from, 'to', span.to].join('-') + '.csv',
      body: auditCsv(entries),
    };
  });
}
