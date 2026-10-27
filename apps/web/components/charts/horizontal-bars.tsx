import type { CSSProperties } from 'react';
import { ChartFrame } from './chart-frame';
import { niceMax, toneBackground, type Tone } from './chart-scale';

/**
 * Sorted horizontal bars (Frontend Specification section 8: physio workload, notes on time, top
 * diagnoses, feedback themes): the biggest first, the name on the left, the value at the end of
 * its bar. Rows past `limit` (top 10) are left out, and the table says so.
 */
export function HorizontalBars({
  label,
  rows,
  tone = 'viz-1',
  limit = 10,
  format = String,
}: {
  label: string;
  rows: readonly { label: string; value: number }[];
  tone?: Tone;
  limit?: number;
  format?: (value: number) => string;
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const shown = sorted.slice(0, limit);
  const top = niceMax(Math.max(0, ...shown.map((row) => row.value)));
  const tableRows = shown.map((row) => [row.label, format(row.value)]);
  if (sorted.length > shown.length) {
    tableRows.push([`${String(sorted.length - shown.length)} more not shown`, '']);
  }
  return (
    <ChartFrame label={label} table={{ columns: ['', 'Value'], rows: tableRows }}>
      <ul className="flex flex-col gap-1.5" aria-label={label}>
        {shown.map((row, index) => (
          <li
            key={String(index)}
            className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-2 text-sm"
            data-words={`${row.label}: ${format(row.value)}`}
            data-testid="hbar"
          >
            <span className="truncate text-ink">{row.label}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={`cmx-marker h-3 rounded-r-sm ${toneBackground[tone]}`}
                style={
                  {
                    width: `${String((row.value / top) * 85)}%`,
                    '--cmx-delay': `${String(index * 12)}ms`,
                  } as CSSProperties
                }
              />
              <span className="shrink-0 tabular-nums text-ink-secondary">{format(row.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}
