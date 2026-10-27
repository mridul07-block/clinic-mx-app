'use client';

import { dashboardTabLabels, dashboardTabs } from '@clinic-mx/schemas';
import { usePathname } from 'next/navigation';
import { RecordTabs } from '../../../../../components/record-tabs';

/** The dashboard's tabs (DSH-03), as the patient record's: links, the open one marked. */
export function DashboardTabs() {
  const path = usePathname();
  const tabs = dashboardTabs.map((tab) => ({
    key: tab,
    label: dashboardTabLabels[tab],
    href: `/app/dashboard/${tab}`,
  }));
  return (
    <RecordTabs
      label="Dashboard"
      tabs={tabs}
      current={tabs.find((tab) => path.startsWith(tab.href))?.key ?? 'alerts'}
    />
  );
}
