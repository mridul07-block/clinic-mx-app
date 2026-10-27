import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '../../../../../../modules/auth/session';
import { alertsDashboard } from '../../../../../../modules/reporting/manager';

export const metadata: Metadata = { title: 'Alerts · Dashboard · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Alerts (DSH-03, the Centre Manager's home): what needs attention now at each centre the reader
// sees, as counts linking to their lists; never a patient here.
export default async function DashboardAlertsPage() {
  const view = await alertsDashboard(await requireStaff());
  const waiting = view.items.filter((item) => item.total > 0);
  const clear = view.items.filter((item) => item.total === 0);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="alerts-now">
      <h2 id="alerts-now" className="font-semibold text-ink">
        Needs attention now
      </h2>
      {waiting.length === 0 ? (
        <p className="text-ink-secondary" data-testid="alerts-clear">
          Nothing waiting at your centres.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
          {waiting.map((item) => (
            <li
              key={item.item}
              className="flex flex-col gap-1 p-4"
              data-testid="alert-count"
              data-item={item.item}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-ink">{item.label}</span>
                <span className="text-title font-semibold tabular-nums text-ink">{item.total}</span>
              </span>
              {view.centres.length > 1 ? (
                <span className="text-sm text-ink-secondary">
                  {item.byCentre
                    .filter((entry) => entry.n > 0)
                    .map((entry) => `${entry.name} ${String(entry.n)}`)
                    .join(', ')}
                </span>
              ) : null}
              {item.link ? (
                <Link
                  href={item.link}
                  className="self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-2"
                >
                  Open the list<span className="sr-only">: {item.label}</span>
                </Link>
              ) : (
                <span className="text-sm text-ink-secondary">{item.where}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {clear.length > 0 ? (
        <p className="text-sm text-ink-muted">
          None now: {clear.map((item) => item.label.toLowerCase()).join('; ')}.
        </p>
      ) : null}
      <h2 className="font-semibold text-ink">Not measured yet</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {view.coming.map((entry) => (
          <li key={entry.label} data-testid="alert-coming">
            <span className="text-ink">{entry.label}:</span>{' '}
            <span className="text-ink-secondary">{entry.needs}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
