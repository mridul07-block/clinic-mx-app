import { kpiPeriodLabels, kpiPeriods, kpiStatusLabels, type KpiStatus } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { figuresView, type Figure } from '../../../../../modules/reporting/kpis';

export const metadata: Metadata = { title: 'Figures · Clinic Mx' };

// Figures (DSH-01): every PRD section 9 figure and the dashboard counts, today and over the last 7
// and 30 days, overall and by centre, counted live from the records. A plain table view for the
// Super Admin; the dashboards draw the same figures as charts.
export const dynamic = 'force-dynamic';

const statusClass: Record<KpiStatus, string> = {
  on_target: 'text-active',
  off_target: 'text-waiting',
  no_data: 'text-ink-muted',
};

export default async function FiguresPage() {
  const staff = await requirePermission('dashboard.overview');
  const view = await figuresView(staff);
  const measured = view.figures.filter((figure) => figure.needs === null);
  const waiting = view.figures.filter((figure) => figure.needs !== null);
  return (
    <main className="flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Figures</h1>
        <p className="text-ink-secondary">
          All centres, counted from the records at{' '}
          <span className="tabular-nums" data-testid="figures-counted-at">
            {view.countedAt}
          </span>
          . Each day is an IST day.
        </p>
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="figures-measured">
        <h2 id="figures-measured" className="font-semibold text-ink">
          Measured
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="figures-measured">
          {measured.map((figure) => (
            <FigureCard key={figure.key} figure={figure} />
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="figures-waiting">
        <h2 id="figures-waiting" className="font-semibold text-ink">
          Not measured yet
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="figures-waiting">
          {waiting.map((figure) => (
            <li
              key={figure.key}
              className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4"
              data-testid="figure"
              data-figure={figure.key}
            >
              <h3 className="font-medium text-ink">{figure.label}</h3>
              {figure.target ? (
                <p className="text-sm text-ink-secondary">Target: {figure.target}</p>
              ) : null}
              <p className="text-sm text-ink-muted">{figure.definition}</p>
              <p className="text-sm text-ink-secondary">Waiting for: {figure.needs}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function FigureCard({ figure }: { figure: Figure }) {
  return (
    <li
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
      data-testid="figure"
      data-figure={figure.key}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-ink">{figure.label}</h3>
        {figure.target ? (
          <p className="text-sm text-ink-secondary">Target: {figure.target}</p>
        ) : null}
        <p className="text-sm text-ink-muted">{figure.definition}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {kpiPeriods.map((period) => {
          const shown = figure.periods[period];
          return (
            <div key={period} className="flex min-w-0 flex-col" data-period={period}>
              <dt className="text-xs text-ink-muted">{kpiPeriodLabels[period]}</dt>
              {shown.status === 'no_data' || shown.text === 'No data yet' ? (
                <dd className="text-sm text-ink-muted">No data yet</dd>
              ) : (
                <dd className="text-lg font-semibold break-words tabular-nums text-ink">
                  {shown.text}
                </dd>
              )}
              {shown.status && shown.status !== 'no_data' ? (
                <dd className={`text-xs ${statusClass[shown.status]}`}>
                  {kpiStatusLabels[shown.status]}
                </dd>
              ) : null}
            </div>
          );
        })}
      </dl>
      <details className="text-sm">
        <summary className="cursor-pointer text-ink-secondary pointer-coarse:py-2">
          By centre
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">{figure.label} by centre</caption>
            <thead>
              <tr className="text-xs text-ink-muted">
                <th scope="col" className="py-1 font-normal">
                  Centre
                </th>
                {kpiPeriods.map((period) => (
                  <th key={period} scope="col" className="py-1 text-right font-normal">
                    {kpiPeriodLabels[period]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {figure.centres.map((entry) => (
                <tr key={entry.id} className="border-t border-line">
                  <th scope="row" className="py-1 font-normal text-ink">
                    {entry.name}
                  </th>
                  {kpiPeriods.map((period) => (
                    <td key={period} className="py-1 text-right text-ink">
                      {entry.periods[period]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </li>
  );
}
