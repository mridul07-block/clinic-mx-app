import { Page, PageHeader } from '@clinic-mx/ui/components/page';
import type { Metadata } from 'next';
import Link from 'next/link';
import { KpiPanel } from '../../../../../components/dashboard/kpi-panel';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { overviewView } from '../../../../../modules/reporting/overview';

export const metadata: Metadata = { title: 'Home · Clinic Mx' };
export const dynamic = 'force-dynamic';

const minutes = (value: number | null) => (value === null ? 'none' : `${String(value)} min`);

// The Super Admin's Home (DSH-05; the user's review, 3 November 2026): what needs them now, each
// centre today, and the week. Charts, targets and every other figure are on Reports.
export default async function HomePage() {
  const staff = await requirePermission('dashboard.overview');
  const view = await overviewView(staff);
  return (
    <Page>
      <PageHeader title="Home" context={`All centres, counted at ${view.countedAt}`} />
      <section className="flex flex-col gap-3" aria-labelledby="home-needs">
        <h2 id="home-needs" className="font-semibold text-ink">
          Needs you now
        </h2>
        {view.needs.length === 0 ? (
          <p className="text-ink-secondary" data-testid="home-clear">
            Nothing waiting.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-clip rounded-panel border border-line bg-surface">
            {view.needs.map((item) => {
              const row = (
                <>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-ink">{item.label}</span>
                    {item.link ? null : (
                      <span className="text-sm text-ink-secondary">{item.where}</span>
                    )}
                  </span>
                  <span className="text-lg font-semibold text-ink tabular-nums">{item.total}</span>
                </>
              );
              const rowClass = 'flex min-h-row-touch items-center justify-between gap-3 px-4 py-2';
              return (
                <li key={item.item} data-testid="home-need" data-item={item.item}>
                  {item.link ? (
                    <Link href={item.link} className={`${rowClass} hover:bg-surface-hover`}>
                      {row}
                    </Link>
                  ) : (
                    <div className={rowClass}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="home-today">
        <h2 id="home-today" className="font-semibold text-ink">
          Today by centre
        </h2>
        <ul className="divide-y divide-line overflow-clip rounded-panel border border-line bg-surface">
          {view.centres.map((entry) => (
            <li
              key={entry.id}
              className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 md:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))] md:items-center"
              data-testid="overview-centre"
              data-centre={entry.name}
            >
              <h3 className="col-span-2 font-medium text-ink md:col-span-1">{entry.name}</h3>
              <dl className="contents tabular-nums">
                <div className="flex flex-col">
                  <dt className="text-sm text-ink-muted">Collected</dt>
                  <dd className="font-medium text-ink" data-testid="overview-collected">
                    {entry.collected}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-sm text-ink-muted">Waiting</dt>
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
                </div>
                <div className="flex flex-col">
                  <dt className="text-sm text-ink-muted">No shows</dt>
                  <dd className="text-ink">{entry.noShows}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-sm text-ink-muted">Payment pending</dt>
                  <dd className="text-ink">
                    {entry.paymentPending.sinceToday + entry.paymentPending.earlier}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="home-week">
        <h2 id="home-week" className="font-semibold text-ink">
          Last 7 days
        </h2>
        <KpiPanel cells={view.cells} />
      </section>
    </Page>
  );
}
