import { discountPresetRecord } from '@clinic-mx/db';
import { rupeesText } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '../../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../../modules/access/staff-db';
import { DiscountPresetForm, PriceActiveForm } from '../../price-forms';
import { ActiveSection, Details, PricePage } from '../../price-page';
import { discountText, notices } from '../../price-text';

export const metadata: Metadata = { title: 'Discount · Clinic Mx' };

// One preset discount (SET-02): its name and amount off, and deactivate or reactivate.
export default async function DiscountPresetPage({
  params,
  searchParams,
}: {
  params: Promise<{ discountPresetId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('prices.manage');
  const { discountPresetId } = await params;
  if (!z.guid().safeParse(discountPresetId).success) notFound();
  const discount = await asStaff(staff, (tx) => discountPresetRecord(tx, discountPresetId));
  if (!discount) notFound();
  const notice = notices('Discount')[(await searchParams).done ?? ''];

  return (
    <PricePage
      title={discount.name}
      active={discount.active}
      notice={notice}
      readOnly={staff.support}
    >
      {staff.support ? (
        <Details rows={[['Discount', discountText(discount)]]} />
      ) : (
        <>
          <DiscountPresetForm
            discount={{
              discountPresetId: discount.id,
              name: discount.name,
              kind: discount.kind,
              percent: discount.kind === 'percent' ? String(discount.percent) : '',
              amount: discount.kind === 'flat' ? rupeesText(discount.amountPaise) : '',
            }}
          />
          <ActiveSection active={discount.active}>
            <PriceActiveForm
              what="discounts"
              id={discount.id}
              name={discount.name}
              noun="discount"
              active={discount.active}
            />
          </ActiveSection>
        </>
      )}
    </PricePage>
  );
}
