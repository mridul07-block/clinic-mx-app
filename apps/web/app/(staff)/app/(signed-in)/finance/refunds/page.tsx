import {
  documentDate,
  documentDateTime,
  financeComing,
  formatRupees,
  paymentMethodLabels,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { secondaryButtonClass } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { refundsView } from '../../../../../../modules/billing/refunds';
import { RefundForm } from './refund-form';

export const metadata: Metadata = { title: 'Refunds · Finance · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Refunds (BIL-11, Frontend Specification section 6 "Refunds and credits"): Finance or the Super
// Admin finds a payment by its bill or invoice number and records money given back; the newest
// refunds below, by bill number, never the patient's name. Credits wait for decision 12.
export default async function FinanceRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ number?: string }>;
}) {
  const actor = await requirePermission('refunds.manage');
  const { number } = await searchParams;
  const view = await refundsView(actor, number);
  const found = view.found;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="refund-find" className="flex flex-col gap-3">
        <h2 id="refund-find" className="font-semibold text-ink">
          Refund a payment
        </h2>
        <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="font-medium text-ink">Bill or invoice number</span>
            <input
              name="number"
              defaultValue={number ?? ''}
              autoComplete="off"
              className="h-row w-full rounded-control border border-line-control bg-surface px-3 font-mono text-ink shadow-xs hover:border-ink-muted pointer-coarse:h-row-touch"
            />
          </label>
          <button type="submit" className={`${secondaryButtonClass} sm:w-auto`}>
            Find
          </button>
        </form>
        {found.status === 'invalid' ? (
          <p className="text-sm text-danger" data-testid="refund-lookup">
            {found.error}
          </p>
        ) : null}
        {found.status === 'missing' ? (
          <p className="text-sm text-ink-secondary" data-testid="refund-lookup">
            No paid bill or invoice {found.number} that you can see.
          </p>
        ) : null}
        {found.status === 'found' ? (
          <div
            className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-3"
            data-testid="refund-payment"
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-secondary">Bill</dt>
              <dd className="font-mono text-ink">{found.payment.billNumber}</dd>
              {found.payment.invoiceNumber ? (
                <>
                  <dt className="text-ink-secondary">Invoice</dt>
                  <dd className="font-mono text-ink">{found.payment.invoiceNumber}</dd>
                </>
              ) : null}
              <dt className="text-ink-secondary">Centre</dt>
              <dd className="text-ink">{found.payment.centreName}</dd>
              <dt className="text-ink-secondary">OP number</dt>
              <dd className="font-mono text-ink">{found.payment.opNumber}</dd>
              <dt className="text-ink-secondary">Paid</dt>
              <dd className="tabular-nums text-ink">
                {formatRupees(found.payment.paidPaise)} by{' '}
                {paymentMethodLabels[found.payment.method]}, {documentDate(found.payment.paidAt)}
              </dd>
              <dt className="text-ink-secondary">Refunded</dt>
              <dd className="tabular-nums text-ink" data-testid="refunded-so-far">
                {formatRupees(found.payment.refundedPaise)}
              </dd>
            </dl>
            {found.payment.livePackage ? (
              <p className="text-sm text-ink-secondary" data-testid="refund-package">
                Refunding all of it closes the package {found.payment.livePackage.name}:{' '}
                {String(found.payment.livePackage.used)} of{' '}
                {String(found.payment.livePackage.total)} sessions used.
              </p>
            ) : null}
            {found.leftPaise > 0 ? (
              <RefundForm
                key={found.payment.paymentId}
                paymentId={found.payment.paymentId}
                left={formatRupees(found.leftPaise)}
              />
            ) : (
              <p className="text-sm text-ink-secondary" role="status">
                This payment is refunded in full.
              </p>
            )}
          </div>
        ) : null}
      </section>
      <section aria-labelledby="refund-history" className="flex flex-col gap-2">
        <h2 id="refund-history" className="font-semibold text-ink">
          Refunds
        </h2>
        {view.history.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="no-refunds">
            No refunds yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="refunds">
            {view.history.map((refund) => (
              <li
                key={refund.id}
                className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-3 text-sm"
                data-testid="refund-row"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-ink">{refund.billNumber}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {formatRupees(refund.amountPaise)}
                  </span>
                </span>
                <span className="text-ink-secondary">
                  {refund.centreName} · {paymentMethodLabels[refund.method]}
                  {refund.reference ? ` · Ref ${refund.reference}` : null}
                </span>
                <span className="break-words text-ink">{refund.reason}</span>
                <span className="text-ink-muted">
                  Approved by {refund.approvedByName}, {documentDateTime(refund.approvedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-ink-muted">{financeComing.credits}</p>
      </section>
    </div>
  );
}
