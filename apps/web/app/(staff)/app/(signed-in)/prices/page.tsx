import { discountPresetList, packageTypeList, priceItemList } from '@clinic-mx/db';
import { accessScope, formatRupees } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FormMessage, secondaryButtonClass } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { discountText } from './price-text';

export const metadata: Metadata = { title: 'Prices · Clinic Mx' };

const rowClass = 'flex flex-col gap-1 rounded-panel border border-line bg-surface p-4';

/** A row: a link to edit it for those who keep prices, plain text for those who read them. */
function Row({ href, children }: { href?: string; children: ReactNode }) {
  return href ? (
    <Link href={href} className={`${rowClass} hover:bg-surface-hover`}>
      {children}
    </Link>
  ) : (
    <div className={rowClass}>{children}</div>
  );
}

function Heading({ name, active, amount }: { name: string; active: boolean; amount: string }) {
  return (
    <span className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{name}</span>
        {active ? null : <Tag tone="neutral">Inactive</Tag>}
      </span>
      <span className="font-semibold text-ink tabular-nums">{amount}</span>
    </span>
  );
}

function Section({
  title,
  add,
  empty,
  children,
}: {
  title: string;
  add?: { href: string; label: string };
  empty?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {add ? (
        <Link href={add.href} className={secondaryButtonClass}>
          {add.label}
        </Link>
      ) : null}
      {empty ? (
        <p className="text-ink-secondary">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">{children}</ul>
      )}
    </section>
  );
}

// The price master (SET-02, Frontend Specification section 6 "Price master"): list prices,
// package types and preset discounts. Finance and the Super Admin keep it (prices.manage);
// Centre Managers and the front desk read it (prices.view). Read under row level security.
export default async function PricesPage() {
  const staff = await requirePermission('prices.view');
  const { items, types, discounts } = await asStaff(staff, async (tx) => ({
    items: await priceItemList(tx),
    types: await packageTypeList(tx),
    discounts: await discountPresetList(tx),
  }));
  const opens = Boolean(accessScope(staff, 'prices.manage'));
  const adds = opens && !staff.support;
  const link = (path: string) => (opens ? `/app/prices/${path}` : undefined);

  return (
    <main className="flex w-full max-w-signin flex-col gap-8 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Prices</h1>
        <p className="text-ink-secondary">
          {opens
            ? 'Bills use these prices. A change applies to new bills; bills already made keep their price.'
            : 'The clinic’s prices. Finance keeps them up to date.'}
        </p>
      </div>
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : null}

      <Section
        title="Price list"
        add={adds ? { href: '/app/prices/items/new', label: 'Add a price' } : undefined}
      >
        {items.map((item) => (
          <li key={item.id} data-testid="price-item">
            <Row href={link(`items/${item.id}`)}>
              <Heading
                name={item.label}
                active={item.active}
                amount={formatRupees(item.amountPaise)}
              />
            </Row>
          </li>
        ))}
      </Section>

      <Section
        title="Package types"
        add={adds ? { href: '/app/prices/packages/new', label: 'Add a package type' } : undefined}
        empty={
          types.length === 0
            ? 'No package types yet. They are added when the clinic agrees what each package covers.'
            : undefined
        }
      >
        {types.map((type) => (
          <li key={type.id} data-testid="package-type">
            <Row href={link(`packages/${type.id}`)}>
              <Heading
                name={type.name}
                active={type.active}
                amount={formatRupees(type.pricePaise)}
              />
              <span className="text-sm text-ink-secondary">
                {type.sessions} {type.sessions === 1 ? 'session' : 'sessions'} ·{' '}
                {type.items.map((item) => item.label).join(', ')}
              </span>
            </Row>
          </li>
        ))}
      </Section>

      <Section
        title="Preset discounts"
        add={adds ? { href: '/app/prices/discounts/new', label: 'Add a discount' } : undefined}
        empty={
          discounts.length === 0
            ? 'No preset discounts yet. They are added when the clinic sends its list.'
            : undefined
        }
      >
        {discounts.map((discount) => (
          <li key={discount.id} data-testid="discount-preset">
            <Row href={link(`discounts/${discount.id}`)}>
              <Heading
                name={discount.name}
                active={discount.active}
                amount={discountText(discount)}
              />
            </Row>
          </li>
        ))}
      </Section>
    </main>
  );
}
