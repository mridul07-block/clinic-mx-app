import { kpiText, monthLabel } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart } from '../../../../../components/charts/bar-chart';
import { KpiPanel } from '../../../../../components/dashboard/kpi-panel';
import { OutcomeBulletCard } from '../../../../../components/dashboard/outcome-bullet-card';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { overviewView } from '../../../../../modules/reporting/overview';

export const metadata: Metadata = { title: 'Overview · Clinic Mx' };
export const dynamic = 'force-dynamic';

const lakhs = (paise: number) => kpiText(Math.round(paise), 'paise');
const minutes = (value: number | null) => (value === null ? 'none' : `${String(value)} min`);

// The Super Admin's overview (DSH-05): every centre at a glance today, the week, the SOP targets,
// revenue by month and the AI's top 3 accuracy (with AI-03). The Super Admin lands here.
export default async function OverviewPage() {
  const staff = await requirePermission('dashboard.overview');
  const view = await overviewView(staff);
  return (
    <main className="flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Overview</h1>
        <p className="text-sm text-ink-secondary">
          All centres, counted at <span className="tabular-nums">{view.countedAt}</span>.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/app/dashboard" className="text-accent underline underline-offset-2">
            Alerts and outcomes
          </Link>
          <Link href="/app/finance" className="text-accent underline underline-offset-2">
            Finance
          </Link>
          <Link href="/app/figures" className="text-accent underline underline-offset-2">
            All figures
          </Link>
        </p>
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="overview-today">
        <h2 id="overview-today" className="font-semibold text-ink">
          Today
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {view.centres.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
              data-testid="overview-centre"
              data-centre={entry.name}
            >
              <h3 className="font-medium text-ink">{entry.name}</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm tabular-nums">
                <dt className="text-ink-muted">Collected</dt>
                <dd className="text-ink" data-testid="overview-collected">
                  {entry.collected}
                </dd>
                <dt className="text-ink-muted">Utilisation</dt>
                <dd className="text-ink">
                  {entry.utilisation === null ? 'No hours today' : `${String(entry.utilisation)}%`}
                </dd>
                <dt className="text-ink-muted">No shows</dt>
                <dd className="text-ink">{entry.noShows}</dd>
                <dt className="text-ink-muted">Waiting now</dt>
                <dd
                  className={
                    (entry.waiting.longestNow ?? 0) > view.runningLateMinutes
                      ? 'font-medium text-waiting'
                      : 'text-ink'
                  }
                >
                  {entry.waiting.now === 0
                    ? 'Nobody'
                    : `${String(entry.waiting.now)}, longest ${minutes(entry.waiting.longestNow)}`}
                </dd>
                <dt className="text-ink-muted">Payment pending</dt>
                <dd className="text-ink">
                  {entry.paymentPending.sinceToday + entry.paymentPending.earlier === 0
                    ? 'None'
                    : `${String(entry.paymentPending.sinceToday)} today, ${String(entry.paymentPending.earlier)} earlier`}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="overview-week">
        <h2 id="overview-week" className="font-semibold text-ink">
          Last 7 days
        </h2>
        <KpiPanel cells={view.cells} />
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="overview-targets">
        <h2 id="overview-targets" className="font-semibold text-ink">
          Against the SOP targets, last 90 days
        </h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {view.bullets.map((bullet) => (
            <OutcomeBulletCard key={bullet.key} bullet={bullet} />
          ))}
          <li
            className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4"
            data-testid="overview-ai"
          >
            <span className="font-medium text-ink">{view.aiTop3.label}, by month</span>
            <span className="text-sm text-ink-secondary">Target: {view.aiTop3.target}</span>
            <span className="text-sm text-ink-secondary">
              Not measured yet: {view.aiTop3.needs}
            </span>
          </li>
        </ul>
      </section>
      {[...view.revenue.thisYear, ...view.revenue.lastYear].some((value) => value > 0) ? (
        <BarChart
          label="Revenue by month against the year before"
          categories={view.revenue.months.map((month) => monthLabel(month))}
          series={[
            { name: 'A year before', tone: 'compare', values: view.revenue.lastYear },
            { name: 'This year', tone: 'viz-1', values: view.revenue.thisYear },
          ]}
          soFar={view.revenue.months.length - 1}
          format={lakhs}
        />
      ) : (
        <p className="text-sm text-ink-muted">No payments in the last two years.</p>
      )}
    </main>
  );
}
