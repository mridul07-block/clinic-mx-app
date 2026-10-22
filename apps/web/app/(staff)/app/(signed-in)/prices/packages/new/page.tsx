import { priceItemList } from '@clinic-mx/db';
import { formatRupees } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { requirePermission } from '../../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../../modules/access/staff-db';
import { PackageTypeForm } from '../../price-forms';
import { PricePage } from '../../price-page';

export const metadata: Metadata = { title: 'Add a package type · Clinic Mx' };

// Add a package type (SET-02): sessions, a package price and the active price items it covers.
export default async function NewPackageTypePage() {
  const staff = await requirePermission('prices.manage');
  const items = await asStaff(staff, (tx) => priceItemList(tx));
  return (
    <PricePage title="Add a package type" readOnly={staff.support}>
      {staff.support ? null : (
        <PackageTypeForm
          items={items
            .filter((item) => item.active)
            .map((item) => ({
              id: item.id,
              label: item.label,
              price: formatRupees(item.amountPaise),
              active: true,
            }))}
        />
      )}
    </PricePage>
  );
}
