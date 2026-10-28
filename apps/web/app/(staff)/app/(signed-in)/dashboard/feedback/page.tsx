import { outcomeWindow, outcomeWindowLabels, outcomeWindows } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DonutChart } from '../../../../../../components/charts/donut-chart';
import { requireStaff } from '../../../../../../modules/auth/session';
import {
  feedbackDashboard,
  type FeedbackRecommendation,
  type FeedbackSurveyView,
  type FeedbackTally,
} from '../../../../../../modules/reporting/manager';

export const metadata: Metadata = { title: 'Feedback · Dashboard · Clinic Mx' };
export const dynamic = 'force-dynamic';

/** The Net Promoter Score in words: "+40", "−10", "0", or "No scores". */
function npsText(recommendation: FeedbackRecommendation): string {
  const { nps } = recommendation;
  if (nps === null) return 'No scores';
  return nps > 0 ? `+${String(nps)}` : nps < 0 ? `−${String(Math.abs(nps))}` : '0';
}

/** "1 promoter", "3 promoters". */
function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? '' : 's'}`;
}

/** Each group's Yes and No per question, as cards that read at 360 px (words, not colour). */
function Tallies({
  heading,
  tallies,
  testId,
}: {
  heading: string;
  tallies: FeedbackTally[];
  testId: string;
}) {
  return (
    <section aria-label={heading} className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="font-semibold text-ink">{heading}</h3>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {tallies.map((tally) => (
          <li
            key={tally.key}
            className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
            data-testid="feedback-tally"
          >
            <span className="font-medium text-ink">
              {tally.label} · {tally.answered} answered
            </span>
            {tally.recommendation ? (
              <span className="text-sm text-ink tabular-nums">
                Net Promoter Score {npsText(tally.recommendation)} ·{' '}
                {count(tally.recommendation.promoters, 'promoter')},{' '}
                {count(tally.recommendation.passives, 'passive')},{' '}
                {count(tally.recommendation.detractors, 'detractor')}
              </span>
            ) : null}
            <dl className="flex flex-col gap-1 text-sm">
              {tally.questions.map((question) => (
                <div key={question.key} className="flex flex-wrap justify-between gap-x-3">
                  <dt className="text-ink-secondary">{question.text}</dt>
                  <dd className="text-ink tabular-nums">
                    {question.yes} Yes · {question.no} No
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One survey's answers: per question, by centre, by physio, and what patients wrote. */
function SurveySection({
  id,
  heading,
  byPhysio,
  empty,
  view,
  children,
}: {
  id: string;
  heading: string;
  byPhysio: string;
  empty: string;
  view: FeedbackSurveyView;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4" data-testid={`${id}-section`}>
      <h2 id={id} className="font-semibold text-ink">
        {heading}
      </h2>
      {view.answered === 0 ? (
        <p className="text-ink-secondary" data-testid={`${id}-empty`}>
          {empty}
        </p>
      ) : (
        <>
          {children}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {view.questions.map((question) => (
              <li
                key={question.key}
                className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4"
              >
                <span className="text-ink">{question.text}</span>
                <span className="text-lg font-semibold text-ink tabular-nums">
                  {question.yes} Yes · {question.no} No
                </span>
              </li>
            ))}
          </ul>
          <Tallies heading="By centre" tallies={view.byCentre} testId={`${id}-by-centre`} />
          <Tallies heading={byPhysio} tallies={view.byPhysio} testId={`${id}-by-physio`} />
          <section aria-label={`${heading}: what patients wrote`} className="flex flex-col gap-2">
            <h3 className="font-semibold text-ink">What patients wrote</h3>
            {view.comments.length === 0 ? (
              <p className="text-ink-secondary">No comments in this window.</p>
            ) : (
              <ul
                className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface"
                data-testid={`${id}-comments`}
              >
                {view.comments.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-1 p-4">
                    <span className="text-ink">{entry.comment}</span>
                    <span className="text-sm text-ink-muted">
                      {[entry.when, entry.centre, entry.physio].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}

// Feedback (DSH-03, PAT-04, PAT-07): over a chosen window, the questions at discharge and after
// the consultation, Yes and No, by centre and by physio, the Net Promoter Score from the discharge
// scores against the clinic's target, and what patients wrote. Themes and open complaints arrive
// with PAT-08.
export default async function DashboardFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const window = outcomeWindow((await searchParams).window);
  const view = await feedbackDashboard(await requireStaff(), window);
  const { recommendation } = view.atDischarge;
  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Window" className="flex flex-wrap gap-2">
        {outcomeWindows.map((each) => (
          <Link
            key={each}
            href={`/app/dashboard/feedback?window=${each}`}
            aria-current={each === window ? 'page' : undefined}
            className={`rounded-control border px-3 py-1.5 text-sm pointer-coarse:py-2.5 ${
              each === window
                ? 'border-ink bg-ink text-surface'
                : 'border-line-control bg-surface text-ink'
            }`}
          >
            {outcomeWindowLabels[each]}
          </Link>
        ))}
      </nav>
      <SurveySection
        id="at-discharge"
        heading="At discharge"
        byPhysio="By consultant who discharged"
        empty="No discharge feedback in this window yet. The desk shows patients the discharge feedback QR on the plan and payment sheet once their episode is discharged."
        view={view.atDischarge}
      >
        <div
          className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
          data-testid="net-promoter"
        >
          <DonutChart
            label="How likely patients are to recommend us"
            parts={[
              { label: 'Promoters (9 or 10)', value: recommendation.promoters, tone: 'promoter' },
              { label: 'Passives (7 or 8)', value: recommendation.passives, tone: 'passive' },
              {
                label: 'Detractors (0 to 6)',
                value: recommendation.detractors,
                tone: 'detractor',
              },
            ]}
            centre={npsText(recommendation)}
            centreCaption="NPS"
          />
          <p className="text-sm text-ink-secondary">
            Target: {view.atDischarge.target}. The Net Promoter Score (NPS) is promoters less
            detractors, as a share of the scores.
          </p>
        </div>
      </SurveySection>
      <SurveySection
        id="after-consultation"
        heading="After the consultation"
        byPhysio="By physio who held the consultation"
        empty="No feedback in this window yet. The desk shows patients “Rate your visit” on the plan and payment sheet once their consultation is signed."
        view={view.afterConsultation}
      />
      {view.figures.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
          {view.figures.map((figure) => (
            <li key={figure.label} className="flex flex-col gap-1 p-4">
              <span className="font-medium text-ink">{figure.label}</span>
              {figure.target ? (
                <span className="text-sm text-ink-secondary">Target: {figure.target}</span>
              ) : null}
              <span className="text-sm text-ink-muted">Not measured yet: {figure.needs}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
