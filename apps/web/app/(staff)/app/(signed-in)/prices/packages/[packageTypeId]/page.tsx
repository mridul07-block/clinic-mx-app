import { packageTypeRecord, priceItemList } from '@clinic-mx/db';
import { formatRupees, rupeesText } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '../../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../../modules/access/staff-db';
import { PackageTypeForm, PriceActiveForm } from '../../price-forms';
import { ActiveSection, Details, PricePage } from '../../price-page';
import { notices } from '../../price-text';

export const metadata: Metadata = { title: 'Package type · Clinic Mx' };

// One package type (SET-02): sessions, price and what it covers, and deactivate or reactivate.
export default async function PackageTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ packageTypeId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('prices.manage');
  const { packageTypeId } = await params;
  if (!z.guid().safeParse(packageTypeId).success) notFound();
  const { type, items } = await asStaff(staff, async (tx) => ({
    type: await packageTypeRecord(tx, packageTypeId),
    items: await priceItemList(tx),
  }));
  if (!type) notFound();
  const covered = new Set(type.items.map((item) => item.id));
  const notice = notices('Package type')[(await searchParams).done ?? ''];

  return (
    <PricePage title={type.name} active={type.active} notice={notice} readOnly={staff.support}>
      {staff.support ? (
        <Details
          rows={[
            ['Sessions', String(type.sessions)],
            ['Package price', formatRupees(type.pricePaise)],
            ['Covers', type.items.map((item) => item.label).join(', ')],
          ]}
        />
      ) : (
        <>
          <PackageTypeForm
            packageType={{
              packageTypeId: type.id,
              name: type.name,
              sessions: String(type.sessions),
              price: rupeesText(type.pricePaise),
              itemIds: [...covered],
            }}
            items={items
              .filter((item) => item.active || covered.has(item.id))
              .map((item) => ({
                id: item.id,
                label: item.label,
                price: formatRupees(item.amountPaise),
                active: item.active,
              }))}
          />
          <ActiveSection active={type.active}>
            <PriceActiveForm
              what="packages"
              id={type.id}
              name={type.name}
              noun="package type"
              active={type.active}
            />
          </ActiveSection>
        </>
      )}
    </PricePage>
  );
}
