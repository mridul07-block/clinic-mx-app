import { outcomeWindow, outcomeWindowLabels, outcomeWindows } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DumbbellChart } from '../../../../../../components/charts/dumbbell-chart';
import { Funnel } from '../../../../../../components/charts/funnel';
import { OutcomeBulletCard } from '../../../../../../components/dashboard/outcome-bullet-card';
import { HorizontalBars } from '../../../../../../components/charts/horizontal-bars';
import { requireStaff } from '../../../../../../modules/auth/session';
import { outcomesDashboard } from '../../../../../../modules/reporting/manager';

export const metadata: Metadata = { title: 'Outcomes · Dashboard · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Outcomes (DSH-03): completion and conversion against their SOP targets, the funnel from a
// consultation to a completed plan, top diagnoses and pain from baseline to discharge by
// diagnosis, over a chosen window.
export default async function DashboardOutcomesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const window = outcomeWindow((await searchParams).window);
  const view = await outcomesDashboard(await requireStaff(), window);
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Window" className="flex flex-wrap gap-2">
        {outcomeWindows.map((each) => (
          <Link
            key={each}
            href={`/app/dashboard/outcomes?window=${each}`}
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
      <section className="flex flex-col gap-4" aria-labelledby="outcomes-targets">
        <h2 id="outcomes-targets" className="font-semibold text-ink">
          Against the SOP targets
        </h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {view.bullets.map((bullet) => (
            <OutcomeBulletCard key={bullet.key} bullet={bullet} />
          ))}
        </ul>
      </section>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Funnel
            label="From consultation to completed plan"
            stages={view.funnel.map((stage) => ({ label: stage.label, value: stage.episodes }))}
          />
          <p className="text-xs text-ink-muted">
            Episodes whose first consultation is in the window; {view.inTreatment} still in
            treatment, so not yet discharged.
          </p>
        </div>
        {view.topDiagnoses.length > 0 ? (
          <HorizontalBars label="Top diagnoses" rows={view.topDiagnoses} />
        ) : (
          <p className="text-sm text-ink-muted">No diagnoses signed in this window.</p>
        )}
      </div>
      <section className="flex flex-col gap-2" aria-labelledby="outcomes-diagnosis">
        <h2 id="outcomes-diagnosis" className="font-semibold text-ink">
          Outcomes by diagnosis
        </h2>
        <p className="text-sm text-ink-secondary">
          Pain during activity (0 to 10), from the consultation to the last session, for episodes
          discharged after treatment. Questionnaire scores join when questionnaires arrive (OUT-02).
        </p>
        {view.outcomes.length > 0 ? (
          <DumbbellChart
            label="Pain during activity, baseline against discharge"
            rows={view.outcomes.map((row) => ({
              label: `${row.label} (${String(row.episodes)})`,
              from: row.from,
              to: row.to,
            }))}
            min={0}
            max={10}
            fromLabel="Baseline"
            toLabel="Discharge"
          />
        ) : (
          <p className="text-sm text-ink-muted" data-testid="outcomes-none">
            No diagnosis has {view.minimumEpisodes} or more discharged episodes in this window yet.
          </p>
        )}
        {view.tooFew.length > 0 ? (
          <p className="text-xs text-ink-muted">
            Too few to compare (under {view.minimumEpisodes}):{' '}
            {view.tooFew.map((row) => `${row.label} (${String(row.episodes)})`).join(', ')}.
          </p>
        ) : null}
      </section>
    </div>
  );
}
