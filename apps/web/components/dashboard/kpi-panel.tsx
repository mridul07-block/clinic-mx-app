import type { KpiCell } from '../../modules/reporting/manager';

/**
 * The week's figures in one panel split into cells with hairlines (design system v2: no floating
 * KPI tiles), each with its change on the period before (DSH-03, DSH-05).
 */
export function KpiPanel({ cells }: { cells: readonly KpiCell[] }) {
  return (
    <dl
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line ${
        cells.length === 5 ? 'md:grid-cols-3 lg:grid-cols-5' : 'md:grid-cols-4'
      }`}
      data-testid="kpi-panel"
    >
      {cells.map((cell, index) => (
        <div
          key={cell.key}
          // An odd last cell spans the row's gap (two columns on a phone, and with five cells on a
          // tablet's three), so no empty slot shows; five fit one row on a wide screen.
          className={`flex flex-col gap-1 bg-surface p-4 ${
            cells.length % 2 === 1 && index === cells.length - 1
              ? cells.length === 5
                ? 'col-span-2 lg:col-span-1'
                : 'col-span-2 md:col-span-1'
              : ''
          }`}
          data-kpi={cell.key}
        >
          <dt className="text-sm text-ink-muted">{cell.label}</dt>
          <dd className="text-display font-semibold tabular-nums break-words text-ink">
            {cell.value}
          </dd>
          <dd className="text-xs text-ink-secondary">{cell.change}</dd>
        </div>
      ))}
    </dl>
  );
}
