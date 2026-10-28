import { outcomeWindow, outcomeWindowLabels, outcomeWindows } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '../../../../../../modules/auth/session';
import { feedbackDashboard, type FeedbackTally } from '../../../../../../modules/reporting/manager';

export const metadata: Metadata = { title: 'Feedback · Dashboard · Clinic Mx' };
export const dynamic = 'force-dynamic';

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

// Feedback (DSH-03, PAT-04): the four questions after the consultation, Yes and No over a chosen
// window, by centre and by the physio who held it, and what patients wrote. The recommendation
// score and the themes of what they say arrive with discharge feedback (PAT-07) and PAT-08.
export default async function DashboardFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const window = outcomeWindow((await searchParams).window);
  const view = await feedbackDashboard(await requireStaff(), window);
  return (
    <div className="flex flex-col gap-6">
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
      <section aria-labelledby="after-consultation" className="flex flex-col gap-4">
        <h2 id="after-consultation" className="font-semibold text-ink">
          After the consultation
        </h2>
        {view.answered === 0 ? (
          <p className="text-ink-secondary" data-testid="feedback-empty">
            No feedback in this window yet. The desk shows patients &ldquo;Rate your visit&rdquo; on
            the plan and payment sheet once their consultation is signed.
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="feedback-questions">
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
            <Tallies heading="By centre" tallies={view.byCentre} testId="feedback-by-centre" />
            <Tallies
              heading="By physio who held the consultation"
              tallies={view.byPhysio}
              testId="feedback-by-physio"
            />
            <section aria-labelledby="feedback-comments" className="flex flex-col gap-2">
              <h3 id="feedback-comments" className="font-semibold text-ink">
                What patients wrote
              </h3>
              {view.comments.length === 0 ? (
                <p className="text-ink-secondary">No comments in this window.</p>
              ) : (
                <ul
                  className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface"
                  data-testid="feedback-comments-list"
                >
                  {view.comments.map((entry) => (
                    <li key={entry.id} className="flex flex-col gap-1 p-4">
                      <span className="text-ink">{entry.comment}</span>
                      <span className="text-sm text-ink-muted">
                        {entry.when} · {entry.centre} · {entry.physio}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </section>
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
    </div>
  );
}
