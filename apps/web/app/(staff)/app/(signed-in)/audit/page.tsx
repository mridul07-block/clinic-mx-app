import {
  auditActionLabels,
  auditActorLabel,
  auditEntityLabel,
  auditPartLabels,
  auditPartsFor,
  auditTablesOf,
  auditValue,
  formatIstDateTime,
  type AuditCategory,
  type AuditLogEntry,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { secondaryButtonClass } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { NotAllowedError } from '../../../../../modules/access/guard';
import { readAuditLog, type AuditLogPage } from '../../../../../modules/audit/services';
import { requireStaff } from '../../../../../modules/auth/session';

export const metadata: Metadata = { title: 'Audit log · Clinic Mx' };

const controlClass =
  'h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs hover:border-ink-muted pointer-coarse:h-row-touch';

const categoryTags: Record<AuditCategory, { label: string; tone: Tone }> = {
  clinical_record: { label: 'Clinical record', tone: 'info' },
  clinical: { label: 'Clinical', tone: 'neutral' },
  finance: { label: 'Finance', tone: 'done' },
  admin: { label: 'Setup', tone: 'outline' },
};

// The audit log (ADM-01; PRD M16, section 2): every change and record view, newest first, as the
// person may read it: the Super Admin everything, Centre Managers the clinical events at their
// centres, Finance the money events. A clinical record's values show only to clinicians.
export default async function AuditLogPageView({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff();
  if (!auditPartsFor(staff).length) redirect('/app/not-allowed');
  const params = Object.fromEntries(
    Object.entries(await searchParams).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );
  let page: AuditLogPage;
  try {
    page = await readAuditLog(staff, params);
  } catch (error) {
    if (error instanceof NotAllowedError) redirect('/app/not-allowed');
    throw error;
  }
  const { parts, query, entries, older } = page;
  const tables = [...new Set(parts.flatMap((part) => auditTablesOf(part)))].sort();
  const olderHref = older
    ? `/app/audit?${new URLSearchParams({
        ...Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'before')),
        before: String(older),
      }).toString()}`
    : null;

  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Audit log</h1>
        <p className="text-ink-secondary">
          Every change and every opened record, newest first. Nothing here can be changed.
        </p>
      </div>

      <form method="get" className="grid gap-3 sm:grid-cols-2" aria-label="Filter the audit log">
        {parts.length > 1 ? (
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-ink">Part</span>
            <select name="part" defaultValue={query.part ?? ''} className={controlClass}>
              <option value="">All</option>
              {parts.map((part) => (
                <option key={part} value={part}>
                  {auditPartLabels[part]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-ink">Record type</span>
          <select name="entity" defaultValue={query.entity ?? ''} className={controlClass}>
            <option value="">Any</option>
            {tables.map((table) => (
              <option key={table} value={table}>
                {auditEntityLabel(table)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-ink">From</span>
          <input name="from" type="date" defaultValue={query.from ?? ''} className={controlClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-ink">To</span>
          <input name="to" type="date" defaultValue={query.to ?? ''} className={controlClass} />
        </label>
        <div className="flex items-center gap-4 sm:col-span-2">
          <button type="submit" className={`${secondaryButtonClass} sm:w-auto`}>
            Show
          </button>
          <Link href="/app/audit" className="text-accent underline underline-offset-2">
            Clear
          </Link>
        </div>
      </form>

      {entries.length ? (
        <ol className="flex flex-col gap-3" data-testid="audit-entries">
          {entries.map((entry) => (
            <AuditEntry key={entry.id} entry={entry} />
          ))}
        </ol>
      ) : (
        <p className="text-ink-secondary" data-testid="audit-none">
          Nothing in the audit log matches.
        </p>
      )}
      {olderHref ? (
        <Link href={olderHref} className="text-accent underline underline-offset-2">
          Older
        </Link>
      ) : null}
    </main>
  );
}

function AuditEntry({ entry }: { entry: AuditLogEntry }) {
  const tag = categoryTags[entry.category];
  const action = auditActionLabels[entry.action] ?? entry.action;
  // A field withheld from this reader says so, rather than looking empty.
  const shown = (row: Record<string, unknown> | null, field: string) =>
    entry.hiddenFields.includes(field) ? 'hidden' : auditValue(row?.[field]);
  const fields =
    entry.action === 'update'
      ? (entry.changed ?? []).map((field) => ({
          field,
          text: entry.hiddenFields.includes(field)
            ? 'changed, hidden'
            : `${shown(entry.before, field)} → ${shown(entry.after, field)}`,
        }))
      : (entry.changed ?? []).map((field) => ({
          field,
          text: shown(entry.after ?? entry.before, field),
        }));
  return (
    <li
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-3"
      data-testid="audit-entry"
      data-entity={entry.entity}
      data-record={entry.entityId ?? ''}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">
          {action}: {auditEntityLabel(entry.entity)}
        </span>
        <Tag tone={tag.tone}>{tag.label}</Tag>
      </div>
      <p className="text-sm text-ink-secondary">
        {formatIstDateTime(entry.at)}, {auditActorLabel(entry.actor, entry.actorName)}
      </p>
      {entry.entityId ? (
        <p className="font-mono text-xs break-all text-ink-muted">Record {entry.entityId}</p>
      ) : null}
      {entry.redacted && entry.changed?.length ? (
        <p className="text-sm text-ink-secondary" data-testid="audit-hidden">
          {entry.action === 'update' ? 'Changed' : 'Fields'}: {entry.changed.join(', ')}.
          The values are part of the clinical record, shown only with the Treats patients tick.
        </p>
      ) : fields.length && entry.action === 'update' ? (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"
          data-testid="audit-changes"
        >
          {fields.map(({ field, text }) => (
            <div key={field} className="contents">
              <dt className="font-mono text-ink-secondary">{field}</dt>
              <dd className="break-all text-ink">{text}</dd>
            </div>
          ))}
        </dl>
      ) : fields.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-secondary">
            {fields.length === 1 ? '1 field' : `${String(fields.length)} fields`}
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {fields.map(({ field, text }) => (
              <div key={field} className="contents">
                <dt className="font-mono text-ink-secondary">{field}</dt>
                <dd className="break-all text-ink">{text}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </li>
  );
}
