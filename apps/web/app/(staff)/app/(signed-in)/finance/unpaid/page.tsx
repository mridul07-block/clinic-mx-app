import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '../../../../../../modules/auth/session';
import { unpaidView } from '../../../../../../modules/reporting/finance';

export const metadata: Metadata = { title: 'Unpaid · Finance · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Unpaid (DSH-04): bills not yet paid, the largest first, by bill and OP number.
export default async function FinanceUnpaidPage() {
  const view = await unpaidView(await requireStaff());
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-secondary">
        <span data-testid="unpaid-summary">
          {view.count === 0
            ? 'No unpaid bills.'
            : `${String(view.count)} unpaid ${view.count === 1 ? 'bill' : 'bills'}, ${view.total} in all.`}
        </span>{' '}
        <Link
          prefetch={false}
          download
          href="/app/finance/export/unpaid"
          className="text-accent underline underline-offset-2"
          data-testid="export-unpaid"
        >
          Download (CSV)
        </Link>
      </p>
      {view.count > 0 ? (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-left text-sm tabular-nums">
            <caption className="sr-only">Unpaid bills, the largest first</caption>
            <thead>
              <tr className="border-b border-line text-ink-muted">
                <th scope="col" className="px-3 py-2 font-medium">
                  Bill
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Centre
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Kind
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Days
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  OP number
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr
                  key={row.number}
                  className="border-b border-line last:border-0"
                  data-testid="unpaid-row"
                >
                  <td className="px-3 py-2 font-mono text-ink">{row.number}</td>
                  <td className="px-3 py-2 text-ink">{row.centre}</td>
                  <td className="px-3 py-2 text-ink">{row.kind}</td>
                  <td className="px-3 py-2 text-right text-ink">{row.amount}</td>
                  <td className="px-3 py-2 text-right text-ink">{row.days}</td>
                  <td className="px-3 py-2 font-mono text-ink">{row.opNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-sm text-ink-muted">{view.coming}</p>
    </div>
  );
}
