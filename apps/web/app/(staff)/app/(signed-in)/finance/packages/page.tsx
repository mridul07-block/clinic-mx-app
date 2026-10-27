import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '../../../../../../modules/auth/session';
import { packagesView } from '../../../../../../modules/reporting/finance';

export const metadata: Metadata = { title: 'Packages · Finance · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Packages (DSH-04): live packages per centre (active, expiring soon, expired with sessions left),
// each linking to its list on the Packages page.
export default async function FinancePackagesPage() {
  const view = await packagesView(await requireStaff());
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {view.centres.map((entry) => (
          <li
            key={entry.name}
            className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
            data-testid="packages-centre"
            data-centre={entry.name}
          >
            <h2 className="font-medium text-ink">{entry.name}</h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm tabular-nums">
              <dt className="text-ink-muted">Active</dt>
              <dd className="text-right text-ink" data-testid="packages-active">
                {entry.active} ({entry.sessionsLeftActive} sessions left)
              </dd>
              <dt className="text-ink-muted">Expiring in {view.expiringDays} days</dt>
              <dd className="text-right text-ink">{entry.expiring}</dd>
              <dt className="text-ink-muted">Expired with sessions left</dt>
              <dd className="text-right text-ink">
                {entry.expired} ({entry.sessionsLeftExpired} sessions)
              </dd>
            </dl>
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/app/packages" className="text-accent underline underline-offset-2">
          Active packages
        </Link>
        <Link
          href="/app/packages?show=expiring"
          className="text-accent underline underline-offset-2"
        >
          Expiring soon
        </Link>
        <Link
          href="/app/packages?show=expired"
          className="text-accent underline underline-offset-2"
        >
          Expired with sessions left
        </Link>
      </p>
    </div>
  );
}
