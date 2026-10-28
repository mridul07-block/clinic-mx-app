import {
  knowledgeVersionDetail,
  knowledgeVersionSignOff,
  knowledgeVersionUsage,
  knowledgeVersions,
} from '@clinic-mx/db';
import {
  accessScope,
  formatIstDateTime,
  importReportSummarySchema,
  knowledgeSourceSummarySchema,
  knowledgeVersionApprovable,
  knowledgeVersionStandingsOf,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { FormMessage } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { StandingTag } from '../standing-tag';
import { ApproveForm } from './approve-form';

export const metadata: Metadata = { title: 'Knowledge base version · Clinic Mx' };

/** One part of the import report, folded until opened. */
function ReportPart({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details data-testid="kb-report-part" className="rounded-panel border border-line bg-surface">
      <summary className="cursor-pointer p-4 font-semibold text-ink pointer-coarse:py-5">
        {title} <span className="font-normal text-ink-muted">({count})</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-line p-4 text-sm text-ink-secondary">
        {count > 0 ? children : <p>None.</p>}
      </div>
    </details>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// One knowledge base version (SET-06): the files it was imported from and its import report, for
// everyone who reads the knowledge base. The Super Admin also sees the records that used it and,
// for a draft newer than the live version, approves it here. Support logins read only.
export default async function KnowledgeVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('knowledge_base.view');
  const { versionId } = await params;
  if (!z.guid().safeParse(versionId).success) notFound();
  const approver = accessScope(staff, 'knowledge_base.edit') !== null;
  const data = await asStaff(staff, async (tx) => {
    const version = await knowledgeVersionDetail(tx, versionId);
    if (!version) return null;
    return {
      version,
      versions: await knowledgeVersions(tx),
      // Counts across every record: the Super Admin only, not a support login.
      usage: approver && !staff.support ? await knowledgeVersionUsage(tx, versionId) : null,
      signOff: approver ? await knowledgeVersionSignOff(tx, versionId) : null,
    };
  });
  if (!data) notFound();
  const { version, versions, usage, signOff } = data;
  const standing = knowledgeVersionStandingsOf(versions).get(version.number) ?? 'awaiting';
  const approvable = knowledgeVersionApprovable(version, versions);
  const live = versions.find((v) => knowledgeVersionStandingsOf(versions).get(v.number) === 'live');
  const source = knowledgeSourceSummarySchema.safeParse(version.source);
  const report = importReportSummarySchema.safeParse(version.report);
  const approved = (await searchParams).done === 'approved';

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/knowledge-base"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          Knowledge base
        </Link>
        <h1 className="text-title font-semibold">Version {version.number}</h1>
        <span className="flex flex-wrap items-center gap-2" data-testid="kb-standing">
          <StandingTag standing={standing} />
        </span>
        <p className="text-sm text-ink-secondary">
          Imported {formatIstDateTime(version.createdAt)}
        </p>
        {version.approvedAt ? (
          <p className="text-sm text-ink-secondary" data-testid="kb-approved">
            Approved {formatIstDateTime(version.approvedAt)}
            {version.approvedByName ? ` by ${version.approvedByName}` : ''}
          </p>
        ) : null}
        {version.notes ? <p className="text-ink">{version.notes}</p> : null}
      </div>
      {approved ? (
        <FormMessage tone="info">
          Version {version.number} is approved. New consultations and session notes use it.
        </FormMessage>
      ) : null}

      {usage ? (
        <section className="flex flex-col gap-1.5" aria-labelledby="usage-heading">
          <h2 id="usage-heading" className="text-lg font-semibold">
            Records that used this version
          </h2>
          <p className="text-ink-secondary" data-testid="kb-usage">
            {plural(usage.consultations, 'consultation', 'consultations')} and{' '}
            {plural(usage.sessions, 'session note', 'session notes')}.
          </p>
        </section>
      ) : null}

      {approver ? (
        <section
          className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
          aria-labelledby="approve-heading"
        >
          <h2 id="approve-heading" className="text-lg font-semibold">
            Approval
          </h2>
          {approvable && signOff ? (
            <>
              {signOff.rules + signOff.modalities > 0 ? (
                <p className="text-sm text-ink-secondary" data-testid="kb-sign-off">
                  {plural(signOff.rules, 'red flag rule', 'red flag rules')} and{' '}
                  {plural(signOff.modalities, 'modality link', 'modality links')} in this version
                  await clinical sign-off. Approving does not sign them off.
                </p>
              ) : null}
              {staff.support ? (
                <p className="text-sm text-ink-muted">Velyx support access is read only.</p>
              ) : (
                <ApproveForm versionId={version.id} number={version.number} />
              )}
            </>
          ) : (
            <p className="text-sm text-ink-secondary" data-testid="kb-not-approvable">
              {version.status === 'approved'
                ? 'This version is approved. An approved version never changes.'
                : `Version ${live?.number ?? ''} is live and newer, so this draft can no longer be approved.`}
            </p>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="source-heading">
        <h2 id="source-heading" className="text-lg font-semibold">
          Source files
        </h2>
        {source.success && source.data.files.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm text-ink-secondary">
            {source.data.files.map((file) => (
              <li key={`${file.name}-${file.sha256}`} className="flex flex-wrap gap-x-2">
                <span className="break-all text-ink">{file.name}</span>
                <span className="font-mono text-ink-muted" title={file.sha256}>
                  {file.sha256.slice(0, 12)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No source files were recorded.</p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="report-heading">
        <h2 id="report-heading" className="text-lg font-semibold">
          Import report
        </h2>
        {report.success ? (
          <>
            {report.data.totals ? (
              <p className="text-sm text-ink-secondary" data-testid="kb-totals">
                {plural(report.data.totals.listings, 'listing', 'listings')} from the workbooks
                became {plural(report.data.totals.conditions, 'condition', 'conditions')} (
                {report.data.totals.merged} merged).
              </p>
            ) : null}
            <ReportPart title="Workbooks" count={report.data.files.length}>
              <ul className="flex flex-col gap-1">
                {report.data.files.map((file) => (
                  <li key={file.fileName}>
                    <span className="text-ink">{file.fileName}</span>:{' '}
                    {plural(file.rows, 'row', 'rows')}
                  </li>
                ))}
              </ul>
            </ReportPart>
            <ReportPart title="Gaps" count={report.data.gaps.length}>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {report.data.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </ReportPart>
            <ReportPart
              title="Conditions merged across workbooks"
              count={report.data.merged.length}
            >
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {report.data.merged.map((merge) => (
                  <li key={merge.conditionId}>{merge.conditionId}</li>
                ))}
              </ul>
            </ReportPart>
            <ReportPart title="Look-alike names" count={report.data.lookAlikes.length}>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {report.data.lookAlikes.map((pair) => (
                  <li key={`${pair.a.name}|${pair.b.name}`}>
                    {pair.a.name} and {pair.b.name}
                  </li>
                ))}
              </ul>
            </ReportPart>
            <ReportPart title="Text copied across conditions" count={report.data.copiedText.length}>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {report.data.copiedText.map((copy, index) => (
                  <li key={`${copy.column}-${String(index)}`}>
                    <span className="font-medium text-ink">{copy.column}:</span> {copy.text}
                  </li>
                ))}
              </ul>
            </ReportPart>
            <ReportPart title="Red flag tiers" count={Object.keys(report.data.redFlagTiers).length}>
              <ul className="flex flex-col gap-1">
                {Object.entries(report.data.redFlagTiers).map(([tier, n]) => (
                  <li key={tier}>
                    {tier}: {n}
                  </li>
                ))}
              </ul>
            </ReportPart>
            <ReportPart title="Conditions without a tag" count={report.data.untagged.length}>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {report.data.untagged.map((item, index) => (
                  <li key={`${item.name}-${String(index)}`}>{item.name}</li>
                ))}
              </ul>
            </ReportPart>
            <ReportPart title="Unmatched entries" count={report.data.unmatched.length}>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {report.data.unmatched.map((item) => (
                  <li key={`${item.key}-${item.conditionId}`}>
                    {item.key} ({item.conditionId})
                  </li>
                ))}
              </ul>
            </ReportPart>
          </>
        ) : (
          <p className="text-sm text-ink-muted">This version’s import report could not be read.</p>
        )}
      </section>
    </main>
  );
}
