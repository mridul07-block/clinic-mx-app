import { priceItemRecord } from '@clinic-mx/db';
import { formatRupees, rupeesText } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '../../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../../modules/access/staff-db';
import { PriceActiveForm, PriceItemForm } from '../../price-forms';
import { ActiveSection, Details, PricePage } from '../../price-page';
import { notices } from '../../price-text';

export const metadata: Metadata = { title: 'Price · Clinic Mx' };

// One list price (SET-02): its name and amount, and deactivate or reactivate.
export default async function PriceItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ priceItemId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('prices.manage');
  const { priceItemId } = await params;
  if (!z.guid().safeParse(priceItemId).success) notFound();
  const item = await asStaff(staff, (tx) => priceItemRecord(tx, priceItemId));
  if (!item) notFound();
  const notice = notices('Price')[(await searchParams).done ?? ''];

  return (
    <PricePage title={item.label} active={item.active} notice={notice} readOnly={staff.support}>
      {staff.support ? (
        <Details rows={[['Price', formatRupees(item.amountPaise)]]} />
      ) : (
        <>
          <p className="text-ink-secondary">
            A new price applies to new bills; bills already made keep their price.
          </p>
          <PriceItemForm
            item={{ priceItemId: item.id, label: item.label, amount: rupeesText(item.amountPaise) }}
          />
          <ActiveSection active={item.active}>
            <PriceActiveForm
              what="items"
              id={item.id}
              name={item.label}
              noun="price"
              active={item.active}
            />
          </ActiveSection>
        </>
      )}
    </PricePage>
  );
}
