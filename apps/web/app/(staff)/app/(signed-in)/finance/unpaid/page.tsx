import type { Metadata } from 'next';
import Link from 'next/link';
import { Tag } from '../../../../../../components/tag';
import { requireStaff } from '../../../../../../modules/auth/session';
import { unpaidView } from '../../../../../../modules/reporting/finance';

export const metadata: Metadata = { title: 'Unpaid · Finance · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Unpaid (DSH-04, BIL-10): pay as you go balances per patient, flagged above the set number of
// unpaid sessions, then the bills not yet paid; the largest first, by bill and OP number.
export default async function FinanceUnpaidPage() {
  const view = await unpaidView(await requireStaff());
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2" aria-labelledby="balances-heading">
        <h2 id="balances-heading" className="text-base font-semibold text-ink">
          Patient balances
        </h2>
        <p className="text-sm text-ink-secondary">
          <span data-testid="balances-summary">
            {view.balances.length === 0
              ? 'No patient owes anything.'
              : `${String(view.balances.length)} ${view.balances.length === 1 ? 'patient owes' : 'patients owe'}; flagged above ${String(view.flagAbove)} unpaid sessions. A flag never stops booking or check in.`}
          </span>{' '}
          <Link
            prefetch={false}
            download
            href="/app/finance/export/balances"
            className="text-accent underline underline-offset-2"
            data-testid="export-balances"
          >
            Download (CSV)
          </Link>
        </p>
        {view.balances.length > 0 ? (
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full text-left text-sm tabular-nums">
              <caption className="sr-only">Patient balances, the largest first</caption>
              <thead>
                <tr className="border-b border-line text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    OP number
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Centres
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Bills
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Sessions
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Days
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.balances.map((row) => (
                  <tr
                    key={row.opNumber}
                    className="border-b border-line last:border-0"
                    data-testid="balance-row"
                  >
                    <td className="px-3 py-2 text-ink">
                      <span className="flex flex-col items-start gap-1">
                        <span className="font-mono">{row.opNumber}</span>
                        {row.flagged ? (
                          <span className="whitespace-nowrap">
                            <Tag tone="danger">Over {view.flagAbove} unpaid sessions</Tag>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink">{row.centre}</td>
                    <td className="px-3 py-2 text-right text-ink">{row.amount}</td>
                    <td className="px-3 py-2 text-right text-ink">{row.bills}</td>
                    <td className="px-3 py-2 text-right text-ink">{row.sessions}</td>
                    <td className="px-3 py-2 text-right text-ink">{row.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <h2 className="text-base font-semibold text-ink">Unpaid bills</h2>
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
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-ink">
                    {row.href ? (
                      <Link
                        href={row.href}
                        prefetch={false}
                        className="underline underline-offset-2"
                      >
                        {row.number}
                      </Link>
                    ) : (
                      row.number
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink">{row.centre}</td>
                  <td className="px-3 py-2 text-ink">{row.kind}</td>
                  <td className="px-3 py-2 text-right text-ink">{row.amount}</td>
                  <td className="px-3 py-2 text-right text-ink">{row.days}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-ink">{row.opNumber}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
