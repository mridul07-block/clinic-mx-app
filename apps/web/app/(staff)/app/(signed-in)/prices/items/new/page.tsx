import type { Metadata } from 'next';
import { requirePermission } from '../../../../../../../modules/access/require-permission';
import { PriceItemForm } from '../../price-forms';
import { PricePage } from '../../price-page';

export const metadata: Metadata = { title: 'Add a price · Clinic Mx' };

// Add a list price (SET-02), for example laser or dry needling when the clinic sends them.
export default async function NewPriceItemPage() {
  const staff = await requirePermission('prices.manage');
  return (
    <PricePage title="Add a price" readOnly={staff.support}>
      {staff.support ? null : <PriceItemForm />}
    </PricePage>
  );
}
