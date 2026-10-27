import type { Metadata } from 'next';
import { BarChart } from '../../../../../../components/charts/bar-chart';
import type { Tone } from '../../../../../../components/charts/chart-scale';
import { Heatmap } from '../../../../../../components/charts/heatmap';
import { KpiPanel } from '../../../../../../components/dashboard/kpi-panel';
import { HorizontalBars } from '../../../../../../components/charts/horizontal-bars';
import { requireStaff } from '../../../../../../modules/auth/session';
import { centresDashboard } from '../../../../../../modules/reporting/manager';

export const metadata: Metadata = { title: 'Centres · Dashboard · Clinic Mx' };
export const dynamic = 'force-dynamic';

const centreTones: readonly Tone[] = ['centre-1', 'centre-2', 'centre-3'];

const minutes = (value: number | null) => (value === null ? 'None' : `${String(value)} min`);

// Centres (DSH-03): today at each centre the reader sees (utilisation, no shows, waiting, payment
// pending without amounts), the week's figures against the week before, and the charts of
// Frontend Specification section 8.
export default async function DashboardCentresPage() {
  const view = await centresDashboard(await requireStaff());
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-secondary">
        Counted at <span className="tabular-nums">{view.countedAt}</span>.
      </p>
      <section className="flex flex-col gap-3" aria-labelledby="centres-today">
        <h2 id="centres-today" className="font-semibold text-ink">
          Today
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {view.centres.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
              data-testid="centre-today"
              data-centre={entry.name}
            >
              <h3 className="font-medium text-ink">{entry.name}</h3>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <dt className="text-ink-muted">Utilisation</dt>
                <dd className="tabular-nums text-ink" data-testid="centre-utilisation">
                  {entry.utilisation === null
                    ? 'No hours today'
                    : `${String(entry.utilisation)}% (${String(entry.booked)} of ${String(entry.rostered)} min)`}
                </dd>
                <dt className="text-ink-muted">No shows</dt>
                <dd className="tabular-nums text-ink" data-testid="centre-no-shows">
                  {entry.noShows}
                </dd>
                <dt className="text-ink-muted">Waiting now</dt>
                <dd
                  className={`tabular-nums ${
                    (entry.waiting.longestNow ?? 0) > view.runningLateMinutes
                      ? 'font-medium text-waiting'
                      : 'text-ink'
                  }`}
                  data-testid="centre-waiting-now"
                >
                  {entry.waiting.now === 0
                    ? 'Nobody'
                    : `${String(entry.waiting.now)}, longest ${minutes(entry.waiting.longestNow)}`}
                  {(entry.waiting.longestNow ?? 0) > view.runningLateMinutes
                    ? ', running late'
                    : ''}
                </dd>
                <dt className="text-ink-muted">Waited today</dt>
                <dd className="tabular-nums text-ink">
                  {entry.waiting.median === null
                    ? 'No visits started yet'
                    : `Median ${minutes(entry.waiting.median)}, longest ${minutes(entry.waiting.longest)}`}
                </dd>
                <dt className="text-ink-muted">Payment pending</dt>
                <dd className="tabular-nums text-ink" data-testid="centre-payment-pending">
                  {entry.paymentPending.sinceToday + entry.paymentPending.earlier === 0
                    ? 'None'
                    : `${String(entry.paymentPending.sinceToday)} today, ${String(entry.paymentPending.earlier)} earlier`}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="centres-week">
        <h2 id="centres-week" className="font-semibold text-ink">
          Last 7 days
        </h2>
        <KpiPanel cells={view.cells} />
      </section>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <BarChart
          label="Appointments per centre, last 7 days"
          categories={view.perCentre.categories}
          series={view.perCentre.series.map((entry) => ({
            name: entry.name,
            tone: centreTones[entry.tone] ?? 'viz-1',
            values: entry.values,
          }))}
          soFar={view.perCentre.categories.length - 1}
        />
        {view.channels.parts.some((part) => part.value > 0) ? (
          <div className="flex flex-col gap-1">
            {/* Bars in the data blue: the centre colours are reserved for centres. */}
            <HorizontalBars
              label={`How bookings came in, last ${String(view.channels.days)} days`}
              rows={view.channels.parts.map((part) => ({ label: part.label, value: part.value }))}
            />
            <p className="text-xs text-ink-muted">
              Not in the chart: {view.channels.automatic} booked by Clinic Mx (6 week reviews).
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted" data-testid="channels-none">
            No bookings by WhatsApp, the front desk or walk in during the last {view.channels.days}{' '}
            days
            {view.channels.automatic > 0
              ? `; ${String(view.channels.automatic)} booked by Clinic Mx (6 week reviews).`
              : '.'}
          </p>
        )}
      </div>
      {view.busy.rows.some((row) => row.values.some((value) => (value ?? 0) > 0)) ? (
        <Heatmap
          label={`Busy hours, last ${String(view.busy.days)} days (visits the patient came to)`}
          columns={view.busy.columns}
          rows={view.busy.rows}
          unit="visits"
        />
      ) : (
        <p className="text-sm text-ink-muted" data-testid="busy-none">
          No visits in the last {view.busy.days} days.
        </p>
      )}
    </div>
  );
}
