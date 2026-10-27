import type { ReactNode } from 'react';
import { ChartReadout } from './chart-readout';
import { ChartTable } from './chart-table';

/**
 * A chart with its title, its value readout and its "Show as table" twin (design system v2
 * section 9): every chart of DSH-02 is drawn inside one.
 */
export function ChartFrame({
  label,
  table,
  children,
}: {
  label: string;
  table: { columns: string[]; rows: string[][] };
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2" data-testid="chart">
      <figcaption className="text-sm font-medium text-ink">{label}</figcaption>
      {/* New figures start a fresh readout: no value or highlight left from the old ones. */}
      <ChartReadout key={JSON.stringify(table.rows)} label={label}>
        {children}
      </ChartReadout>
      <ChartTable caption={label} columns={table.columns} rows={table.rows} />
    </figure>
  );
}
