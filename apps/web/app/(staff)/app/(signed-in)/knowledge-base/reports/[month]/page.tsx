import {
  confirmedDiagnosisStageLabels,
  formatIstDateTime,
  inTopPercent,
  monthLabel,
  topWords,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireStaff } from '../../../../../../../modules/auth/session';
import { loadKbReport } from '../../../../../../../modules/ai/kb-report';

export const metadata: Metadata = { title: 'Knowledge base report · Clinic Mx' };

function Section({
  title,
  id,
  intro,
  children,
}: {
  title: string;
  id: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-testid={id}
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      <p className="text-sm text-ink-muted">{intro}</p>
      {children}
    </section>
  );
}

const none = (text: string) => <p className="text-ink-secondary">{text}</p>;

// The monthly knowledge base report (AI-08; PRD section 6, learning loop): suggestions often
// dismissed, diagnoses the assistant missed and diagnoses changed at review, counted for one IST
// month and kept as built. For the Super Admin, who approves knowledge base versions; anyone else
// finds nothing here.
export default async function KbReportPage({ params }: { params: Promise<{ month: string }> }) {
  const staff = await requireStaff();
  const { month } = await params;
  const report = await loadKbReport(staff, month);
  if (!report) notFound();
  const { body } = report;
  const { totals, thresholds } = body;
  const percent = inTopPercent(totals);
  const facts: [string, string][] = [
    [
      'Preparation sheets made',
      `${String(totals.sheetsReady)} ranked, ${String(totals.sheetsUnavailable)} unavailable`,
    ],
    ['Suggestions kept or dismissed', String(totals.marked)],
    ['Suggestions never marked', String(totals.unmarked)],
    ['Diagnoses confirmed', String(totals.labels)],
    ['Compared with a ranked sheet', String(totals.labelsCompared)],
    ['Not compared: no ranked sheet', String(totals.labelsWithoutRanking)],
    ['Not compared: another knowledge base version', String(totals.labelsOtherVersion)],
    ['Changed from the consultation', String(totals.changed)],
  ];

  return (
    <main className="flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/knowledge-base"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          Knowledge base
        </Link>
        <h1 className="text-title font-semibold">
          Knowledge base report for {monthLabel(body.month, true)}
        </h1>
        <p className="text-sm text-ink-secondary">
          Built {formatIstDateTime(report.generatedAt)} and kept as built
          {body.kbVersions.length > 0
            ? ` · knowledge base ${body.kbVersions.length === 1 ? 'version' : 'versions'} ${body.kbVersions.map((v) => String(v.number)).join(', ')}`
            : ''}
          .
        </p>
      </div>

      <section
        aria-labelledby="kb-report-headline"
        data-testid="kb-report-headline"
        className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
      >
        <h2 id="kb-report-headline" className="text-lg font-semibold text-ink">
          {percent === null
            ? 'No confirmed diagnosis to compare this month'
            : `Right diagnosis in ${topWords(thresholds.topCount)}: ${String(percent)}% of ${String(totals.labelsCompared)}`}
        </h2>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Section
        title="Suggestions often dismissed"
        id="kb-report-dismissed"
        intro={`Kept or dismissed at least ${String(thresholds.minMarked)} times this month, and dismissed at least ${String(thresholds.sharePercent)}% of those times.`}
      >
        {body.oftenDismissed.length === 0 ? (
          none('None this month.')
        ) : (
          <ul className="flex flex-col gap-2">
            {body.oftenDismissed.map((row) => (
              <li
                key={[row.kbVersionNumber, row.conditionId].join(':')}
                data-testid="kb-report-dismissed-row"
                className="flex flex-col gap-0.5"
              >
                <span className="font-medium text-ink">{row.name}</span>
                <span className="text-sm text-ink-secondary">
                  Dismissed {row.dismissed} of {row.kept + row.dismissed} ({row.sharePercent}%) ·{' '}
                  {row.conditionId} · version {row.kbVersionNumber}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Diagnoses the assistant missed"
        id="kb-report-missed"
        intro={`Diagnoses confirmed at review or discharge that were not in ${topWords(thresholds.topCount)} of the preparation sheet, with how near they came.`}
      >
        {body.missed.length === 0 ? (
          none('None this month.')
        ) : (
          <ul className="flex flex-col gap-2">
            {body.missed.map((row) => (
              <li
                key={row.conditionId}
                data-testid="kb-report-missed-row"
                className="flex flex-col gap-0.5"
              >
                <span className="font-medium text-ink">
                  {row.name} · {row.count}
                </span>
                <span className="text-sm text-ink-secondary">
                  {[
                    `${String(row.alsoConsider)} under Also consider`,
                    `${String(row.shortlistedNotSuggested)} on the shortlist, not suggested`,
                    `${String(row.notShortlisted)} not on the shortlist`,
                    `${String(row.foundAtRecheck)} found at recheck`,
                  ].join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Diagnoses changed at review"
        id="kb-report-changed"
        intro="Diagnoses confirmed at review or discharge as another condition than the consultation's."
      >
        {body.changed.length === 0 ? (
          none('None this month.')
        ) : (
          <ul className="flex flex-col gap-2">
            {body.changed.map((row) => (
              <li
                key={[row.fromId, row.toId, row.stage].join(':')}
                data-testid="kb-report-changed-row"
                className="flex flex-col gap-0.5"
              >
                <span className="font-medium text-ink">
                  {row.fromName} to {row.toName} · {row.count}
                </span>
                <span className="text-sm text-ink-secondary">
                  {confirmedDiagnosisStageLabels[row.stage]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="text-sm text-ink-muted">
        Knowledge base edits go live only as a new version you approve. Feedback never weakens
        safety: must rule out rows and red flag rules stay fixed.
      </p>
    </main>
  );
}
