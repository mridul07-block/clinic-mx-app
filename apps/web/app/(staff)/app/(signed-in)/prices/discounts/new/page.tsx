import type { Metadata } from 'next';
import { requirePermission } from '../../../../../../../modules/access/require-permission';
import { DiscountPresetForm } from '../../price-forms';
import { PricePage } from '../../price-page';

export const metadata: Metadata = { title: 'Add a discount · Clinic Mx' };

// Add a preset discount (SET-02): the front desk may apply it to a bill (BIL-07).
export default async function NewDiscountPresetPage() {
  const staff = await requirePermission('prices.manage');
  return (
    <PricePage title="Add a discount" readOnly={staff.support}>
      {staff.support ? null : <DiscountPresetForm />}
    </PricePage>
  );
}
