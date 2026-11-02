import { can } from '@clinic-mx/schemas';
import type { ReactNode } from 'react';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { ReportsHeader } from './reports-header';
import { Page } from '@clinic-mx/ui/components/page';

// Reports (DSH-03; the user's review, 3 November 2026): Centres, Outcomes, Team and Feedback, for
// the Super Admin and Centre Managers. Alerts here is the Centre Manager's Home. Each tab reads its
// own figures.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const staff = await requirePermission('dashboard.clinical_operations');
  return (
    <Page width="content">
      <ReportsHeader
        readsMoney={can(staff, 'dashboard.finance')}
        readsFigures={can(staff, 'dashboard.overview')}
      />
      {children}
    </Page>
  );
}
