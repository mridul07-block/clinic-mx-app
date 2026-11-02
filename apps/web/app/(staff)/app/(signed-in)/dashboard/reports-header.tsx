'use client';

import { dashboardTabLabels, dashboardTabs } from '@clinic-mx/schemas';
import { usePathname } from 'next/navigation';
import { RecordTabs } from '../../../../../components/record-tabs';

/**
 * A Centre Manager's Home is the dashboard's Alerts, with no tabs; every other tab is Reports
 * (the user's review, 3 November 2026), with Money and Figures for those who read them.
 */
export function ReportsHeader({
  readsMoney,
  readsFigures,
}: {
  readsMoney: boolean;
  readsFigures: boolean;
}) {
  const path = usePathname();
  if (path.startsWith('/app/dashboard/alerts')) {
    return <h1 className="text-title font-semibold">Home</h1>;
  }
  const tabs = [
    ...dashboardTabs
      .filter((tab) => tab !== 'alerts')
      .map((tab) => ({
        key: tab,
        label: dashboardTabLabels[tab],
        href: `/app/dashboard/${tab}`,
      })),
    ...(readsMoney ? [{ key: 'money', label: 'Money', href: '/app/finance/collections' }] : []),
    ...(readsFigures ? [{ key: 'figures', label: 'Figures', href: '/app/figures' }] : []),
  ];
  return (
    <>
      <h1 className="text-title font-semibold">Reports</h1>
      <RecordTabs
        label="Reports"
        tabs={tabs}
        current={tabs.find((tab) => path.startsWith(tab.href))?.key ?? 'centres'}
      />
    </>
  );
}
