import { knowledgeVersions } from '@clinic-mx/db';
import {
  formatIstDateTime,
  inTopPercent,
  knowledgeVersionStandingsOf,
  monthLabel,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { loadKbReports } from '../../../../../modules/ai/kb-report';
import { StandingTag } from './standing-tag';

export const metadata: Metadata = { title: 'Knowledge base · Clinic Mx' };

// Knowledge base versions (SET-06, PRD M16; FE spec: "Knowledge base viewer: versions, import
// report, approve"): every version the import made, newest first, and where each stands. New
// clinical records take the live version. Clinicians and managers read (knowledge_base.view); the
// Super Admin approves, on a version's page.
export default async function KnowledgeBasePage() {
  const staff = await requirePermission('knowledge_base.view');
  const versions = await asStaff(staff, (tx) => knowledgeVersions(tx));
  const standings = knowledgeVersionStandingsOf(versions);
  const anyApproved = versions.some((version) => version.status === 'approved');
  // AI-08: the monthly reports, for the Super Admin only.
  const reports = await loadKbReports(staff);

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Knowledge base</h1>
        <p className="text-ink-secondary">
          Each version is one import of the workbooks. New consultations and session notes use the
          live version; a record keeps the version it started with.
        </p>
      </div>
      {versions.length > 0 && !anyApproved ? (
        <p
          role="status"
          data-testid="kb-bootstrap"
          className="rounded-control border border-info-line bg-info-soft px-3 py-2 text-info"
        >
          No version is approved yet, so new records use the newest import. Once the Super Admin
          approves a version, only approved versions go live.
        </p>
      ) : null}
      {versions.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {versions.map((version) => {
            const standing = standings.get(version.number) ?? 'awaiting';
            return (
              <li key={version.id} data-testid="kb-version">
                <Link
                  href={`/app/knowledge-base/${version.id}`}
                  className="flex flex-col gap-1.5 rounded-panel border border-line bg-surface p-4 hover:bg-surface-hover"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">Version {version.number}</span>
                    <StandingTag standing={standing} />
                  </span>
                  <span className="text-sm text-ink-secondary">
                    Imported {formatIstDateTime(version.createdAt)}
                  </span>
                  {version.approvedAt ? (
                    <span className="text-sm text-ink-secondary">
                      Approved {formatIstDateTime(version.approvedAt)}
                      {version.approvedByName ? ` by ${version.approvedByName}` : ''}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-ink-secondary">No knowledge base version has been imported yet.</p>
      )}
      <section className="flex flex-col gap-3" aria-labelledby="improvement-heading">
        <h2 id="improvement-heading" className="text-lg font-semibold">
          Monthly knowledge base report
        </h2>
        {reports === null ? (
          <p className="text-sm text-ink-muted">
            Each month the Super Admin gets a report of suggestions often dismissed, diagnoses the
            assistant missed and diagnoses changed at review.
          </p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="kb-reports-none">
            The first report comes on the 1st of next month, for this month.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.map((report) => {
              const percent = inTopPercent(report.body.totals);
              return (
                <li key={report.month} data-testid="kb-report-item">
                  <Link
                    href={['/app/knowledge-base/reports', report.month].join('/')}
                    className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4 hover:bg-surface-hover"
                  >
                    <span className="font-semibold text-ink">{monthLabel(report.month, true)}</span>
                    <span className="text-sm text-ink-secondary">
                      {percent === null
                        ? 'No confirmed diagnosis to compare'
                        : `Right diagnosis in the top suggestions: ${String(percent)}% of ${String(report.body.totals.labelsCompared)}`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
