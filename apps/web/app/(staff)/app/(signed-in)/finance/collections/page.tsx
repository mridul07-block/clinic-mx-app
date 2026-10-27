import { kpiText } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart } from '../../../../../../components/charts/bar-chart';
import { HorizontalBars } from '../../../../../../components/charts/horizontal-bars';
import { requireStaff } from '../../../../../../modules/auth/session';
import { collectionsView } from '../../../../../../modules/reporting/finance';

export const metadata: Metadata = { title: 'Collections · Finance · Clinic Mx' };
export const dynamic = 'force-dynamic';

const lakhs = (paise: number) => kpiText(Math.round(paise), 'paise');

// Collections (DSH-04, Finance's home): today's money by method and by centre, what was undone
// today, and the last 30 days.
export default async function FinanceCollectionsPage() {
  const view = await collectionsView(await requireStaff());
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-secondary">
        Counted at <span className="tabular-nums">{view.countedAt}</span>.{' '}
        <Link
          prefetch={false}
          download
          href="/app/finance/export/collections"
          className="text-accent underline underline-offset-2"
          data-testid="export-collections"
        >
          Download the last 30 days (CSV)
        </Link>
      </p>
      <section className="flex flex-col gap-3" aria-labelledby="collections-today">
        <h2 id="collections-today" className="font-semibold text-ink">
          Today
        </h2>
        <div className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4">
          <span className="text-sm text-ink-muted">Collected today, all centres</span>
          <span
            className="text-display font-semibold tabular-nums text-ink"
            data-testid="collected-today"
          >
            {view.today.total}
          </span>
          <span className="text-xs text-ink-secondary">
            {view.today.undone.payments === 0
              ? 'Nothing undone today.'
              : `${String(view.today.undone.payments)} undone today (${view.today.undone.text}), not counted.`}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <HorizontalBars
            label="Today by method"
            rows={view.today.byMethod.map((row) => ({ label: row.label, value: row.value }))}
            format={lakhs}
          />
          <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface text-sm">
            {view.today.byCentre.map((row) => (
              <li
                key={row.name}
                className="flex items-baseline justify-between gap-3 p-3"
                data-testid="collected-centre"
              >
                <span className="text-ink">{row.name}</span>
                <span className="tabular-nums text-ink">
                  {row.text}{' '}
                  <span className="text-ink-muted">
                    ({row.payments} {row.payments === 1 ? 'payment' : 'payments'})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {view.daily.values.some((value) => value > 0) ? (
        <BarChart
          label="Collected each day, last 30 days"
          categories={view.daily.categories}
          series={[{ name: 'Collected', tone: 'viz-1', values: view.daily.values }]}
          soFar={view.daily.categories.length - 1}
          format={lakhs}
        />
      ) : (
        <p className="text-sm text-ink-muted" data-testid="collections-none">
          No payments in the last 30 days.
        </p>
      )}
    </div>
  );
}
