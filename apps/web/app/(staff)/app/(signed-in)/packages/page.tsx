import {
  istDate,
  packageListFilterLabels,
  packageListFilters,
  type PackageListFilter,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { packageMeterText, packageTag } from '../../../../../components/package-meter';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { packageListFor } from '../../../../../modules/billing/packages';

export const metadata: Metadata = { title: 'Packages · Clinic Mx' };
export const dynamic = 'force-dynamic';

const pillClass = 'rounded-control border px-3 py-1.5 text-sm pointer-coarse:py-2.5';
const querySchema = z.object({ show: z.enum(packageListFilters).catch('active') });

const emptyText: Record<PackageListFilter, string> = {
  active: 'No active packages.',
  expiring: 'No packages expiring soon.',
  expired: 'No expired packages with sessions left.',
};

// Finance's Packages list (BIL-08, Frontend Specification: active, expiring in 14 days, expired
// with sessions left), also for the Super Admin and the front desk at their centres. Soonest
// expiry first; expired ones keep their sessions left until the client decides on credits
// (DECISION 12).
export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const staff = await requirePermission('bills.view_amounts');
  const { show } = querySchema.parse(await searchParams);
  const { rows, expiringDays } = await packageListFor(staff, show);
  const today = istDate(new Date());
  const label = (filter: PackageListFilter) =>
    filter === 'expiring'
      ? `Expiring in ${String(expiringDays)} days`
      : packageListFilterLabels[filter];

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <h1 className="text-title font-semibold">Packages</h1>
      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {packageListFilters.map((filter) => (
          <Link
            key={filter}
            href={`/app/packages?show=${filter}`}
            aria-current={filter === show ? 'page' : undefined}
            className={`${pillClass} ${
              filter === show
                ? 'border-ink bg-surface font-medium text-ink'
                : 'border-line-control text-ink-secondary'
            }`}
          >
            {label(filter)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-ink-muted" data-testid="no-packages">
          {emptyText[show]}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="package-list">
          {rows.map((row) => {
            const tag = packageTag(row, today, expiringDays);
            return (
              <li
                key={row.id}
                data-testid="package-row"
                className="flex flex-col gap-1.5 rounded-panel border border-line bg-surface p-4"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/app/patients/${row.patientId}`}
                    className="font-medium text-ink underline underline-offset-2"
                  >
                    {row.patientName}
                  </Link>
                  <Tag tone={tag.tone}>{tag.label}</Tag>
                </span>
                <span className="text-sm text-ink-secondary">
                  <span className="font-mono text-ink">{row.opNumber}</span> · {row.centreName}
                </span>
                <span className="text-sm text-ink">{row.name}</span>
                <span className="text-sm text-ink-secondary tabular-nums">
                  {packageMeterText(row)}
                </span>
                {row.state === 'expired' ? (
                  <span className="text-sm text-ink-secondary">
                    {row.sessionsLeft} {row.sessionsLeft === 1 ? 'session' : 'sessions'} left
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
