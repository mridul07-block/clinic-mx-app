import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { FinanceTabs } from './finance-tabs';

// Finance's dashboards (DSH-04): Collections, Unpaid, Packages and Revenue, for the Super Admin and
// Finance. Each tab reads its own figures; each table downloads as CSV.
export default async function FinanceLayout({ children }: { children: ReactNode }) {
  await requirePermission('dashboard.finance');
  return (
    <main className="flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Finance</h1>
      </div>
      <FinanceTabs />
      {children}
    </main>
  );
}
