import { kpiText, monthLabel } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart } from '../../../../../../components/charts/bar-chart';
import type { Tone } from '../../../../../../components/charts/chart-scale';
import { HorizontalBars } from '../../../../../../components/charts/horizontal-bars';
import { requireStaff } from '../../../../../../modules/auth/session';
import { revenueView } from '../../../../../../modules/reporting/finance';

export const metadata: Metadata = { title: 'Revenue · Finance · Clinic Mx' };
export const dynamic = 'force-dynamic';

const lakhs = (paise: number) => kpiText(Math.round(paise), 'paise');
const centreTones: readonly Tone[] = ['centre-1', 'centre-2', 'centre-3'];

// Revenue (DSH-04): payments received by month against the same months a year before, this month
// by centre, and the last 12 months by service.
export default async function FinanceRevenuePage() {
  const view = await revenueView(await requireStaff());
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-secondary">
        Payments received and not undone, by the day they were recorded, less refunds on the day
        each was given.{' '}
        <Link
          prefetch={false}
          download
          href="/app/finance/export/revenue"
          className="text-accent underline underline-offset-2"
          data-testid="export-revenue"
        >
          Download by month (CSV)
        </Link>
      </p>
      {[...view.thisYear, ...view.lastYear].some((value) => value > 0) ? (
        <BarChart
          label="Revenue by month against the year before"
          categories={view.months.map((month) => monthLabel(month))}
          series={[
            { name: 'A year before', tone: 'compare', values: view.lastYear },
            { name: 'This year', tone: 'viz-1', values: view.thisYear },
          ]}
          soFar={view.months.length - 1}
          format={lakhs}
        />
      ) : (
        <p className="text-sm text-ink-muted" data-testid="revenue-none">
          No payments in the last two years.
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {view.byCentre.some((entry) => entry.value > 0) ? (
          <BarChart
            label={`${view.thisMonth} by centre`}
            categories={[view.thisMonth]}
            series={view.byCentre.map((entry) => ({
              name: entry.name,
              tone: centreTones[entry.tone] ?? 'viz-1',
              values: [entry.value],
            }))}
            soFar={0}
            format={lakhs}
          />
        ) : (
          <p className="text-sm text-ink-muted">Nothing received yet in {view.thisMonth}.</p>
        )}
        <HorizontalBars
          label="Last 12 months by service"
          rows={view.byService.map((row) => ({ label: row.label, value: row.value }))}
          format={lakhs}
        />
      </div>
      <p className="text-sm text-ink-muted">{view.coming}</p>
    </div>
  );
}
