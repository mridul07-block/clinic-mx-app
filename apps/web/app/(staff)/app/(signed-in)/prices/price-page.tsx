import Link from 'next/link';
import type { ReactNode } from 'react';
import { FormMessage } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';

/** The frame of every price master page below the list: back to Prices, the title, a notice. */
export function PricePage({
  title,
  active,
  notice,
  readOnly,
  children,
}: {
  title: string;
  /** Shown as a tag on an existing row; left out on Add pages. */
  active?: boolean;
  notice?: string;
  /** A Velyx support login sees the page read only (IAM-08). */
  readOnly: boolean;
  children: ReactNode;
}) {
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app/prices" className="text-sm text-ink-muted underline underline-offset-2">
          Prices
        </Link>
        <h1 className="text-title font-semibold">{title}</h1>
        {active === undefined ? null : (
          <span className="flex flex-wrap items-center gap-2">
            {active ? <Tag tone="active">Active</Tag> : <Tag tone="neutral">Inactive</Tag>}
          </span>
        )}
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      {readOnly ? <FormMessage tone="info">Velyx support access is read only.</FormMessage> : null}
      {children}
    </main>
  );
}

/** The deactivate or reactivate section under a form. */
export function ActiveSection({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h2 className="font-semibold text-ink">{active ? 'Deactivate' : 'Reactivate'}</h2>
      {children}
    </section>
  );
}

/** What a support login sees in place of a form. */
export function Details({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-2 text-ink-secondary">
      {rows.map(([term, value]) => (
        <div key={term} className="flex flex-col gap-0.5">
          <dt className="font-medium text-ink">{term}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
