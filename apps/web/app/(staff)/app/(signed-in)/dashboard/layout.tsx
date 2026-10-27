import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { DashboardTabs } from './dashboard-tabs';

// The Centre Manager's dashboards (DSH-03): Alerts, Centres, Outcomes, Team and Feedback, for the
// Super Admin and Centre Managers. Each tab reads its own figures.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requirePermission('dashboard.clinical_operations');
  return (
    <main className="flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Dashboard</h1>
      </div>
      <DashboardTabs />
      {children}
    </main>
  );
}
