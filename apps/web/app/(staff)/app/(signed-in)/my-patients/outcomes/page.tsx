import { outcomeWindow, outcomeWindowLabels, outcomeWindows } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DumbbellChart } from '../../../../../../components/charts/dumbbell-chart';
import { Funnel } from '../../../../../../components/charts/funnel';
import { OutcomeBulletCard } from '../../../../../../components/dashboard/outcome-bullet-card';
import { HorizontalBars } from '../../../../../../components/charts/horizontal-bars';
import { redirect } from 'next/navigation';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { ownOutcomes, readsOwnOutcomes } from '../../../../../../modules/reporting/own-outcomes';

export const metadata: Metadata = { title: 'My patients’ outcomes · Clinic Mx' };
export const dynamic = 'force-dynamic';

// My patients' outcomes (DSH-06; docs/runbooks/own-outcomes.md): the Centre Manager's Outcomes tab
// (DSH-03) over the episodes whose current plan names the reader as treating physio, with the
// clinic's targets for context and no colleague's figures. Adherence waits for My plan.
export default async function OwnOutcomesPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const staff = await requirePermission('dashboard.own_patients');
  if (!readsOwnOutcomes(staff)) redirect('/app/not-allowed');
  const window = outcomeWindow((await searchParams).window);
  const view = await ownOutcomes(staff, window);
  return (
    <main className="flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/my-patients"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          My patients today
        </Link>
        <h1 className="text-title font-semibold">My patients’ outcomes</h1>
        <p className="text-sm text-ink-secondary">
          Episodes whose current plan names you as treating physio, at any centre. The clinic’s
          targets are shown for context; no colleague’s figures are.
        </p>
      </div>
      <nav aria-label="Window" className="flex flex-wrap gap-2">
        {outcomeWindows.map((each) => (
          <Link
            key={each}
            href={`/app/my-patients/outcomes?window=${each}`}
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
          Against the clinic’s targets
        </h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {view.bullets.map((bullet) => (
            <OutcomeBulletCard key={bullet.key} bullet={bullet} />
          ))}
          {view.coming.map((item) => (
            <li
              key={item.label}
              className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4"
              data-testid="own-coming"
            >
              <span className="font-medium text-ink">{item.label}</span>
              <span className="text-sm text-ink-muted">Not measured yet: {item.needs}.</span>
            </li>
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
            Your episodes whose first consultation is in the window; {view.inTreatment} still in
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
    </main>
  );
}
