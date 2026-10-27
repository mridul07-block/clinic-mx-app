'use client';

import { financeTabLabels, financeTabs } from '@clinic-mx/schemas';
import { usePathname } from 'next/navigation';
import { RecordTabs } from '../../../../../components/record-tabs';

/** Finance's tabs (DSH-04), as the patient record's: links, the open one marked. */
export function FinanceTabs() {
  const path = usePathname();
  const tabs = financeTabs.map((tab) => ({
    key: tab,
    label: financeTabLabels[tab],
    href: `/app/finance/${tab}`,
  }));
  return (
    <RecordTabs
      label="Finance"
      tabs={tabs}
      current={tabs.find((tab) => path.startsWith(tab.href))?.key ?? 'collections'}
    />
  );
}
