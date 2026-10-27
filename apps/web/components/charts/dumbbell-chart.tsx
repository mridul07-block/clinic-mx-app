import { ChartFrame } from './chart-frame';

/**
 * A dumbbell chart (Frontend Specification section 8: outcomes by diagnosis, baseline against
 * discharge): per row a grey dot at the start and a blue dot at the end on one shared scale,
 * joined by a line; the row's name above its line, the scale's ends below.
 */

const WIDTH = 320;
const ROW = 36;
const SIDE = 10;
/** About how many 11 px characters fit across a row. */
const ROW_CHARACTERS = Math.floor((WIDTH - SIDE * 2) / 6);

/** A row name that fits its line, cut with an ellipsis; the full name is in its words. */
function fitted(name: string): string {
  return name.length <= ROW_CHARACTERS ? name : `${name.slice(0, ROW_CHARACTERS - 1)}…`;
}

export interface DumbbellRow {
  label: string;
  from: number;
  to: number;
}

export function DumbbellChart({
  label,
  rows,
  min,
  max,
  fromLabel,
  toLabel,
  format = String,
}: {
  label: string;
  rows: readonly DumbbellRow[];
  min: number;
  max: number;
  fromLabel: string;
  toLabel: string;
  format?: (value: number) => string;
}) {
  const height = rows.length * ROW + 22;
  const x = (value: number) =>
    SIDE + ((Math.min(Math.max(value, min), max) - min) / (max - min)) * (WIDTH - SIDE * 2);
  const words = (row: DumbbellRow) =>
    `${row.label}: ${fromLabel} ${format(row.from)}, ${toLabel} ${format(row.to)}`;
  return (
    <ChartFrame
      label={label}
      table={{
        columns: ['', fromLabel, toLabel],
        rows: rows.map((row) => [row.label, format(row.from), format(row.to)]),
      }}
    >
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
      >
        {rows.map((row, index) => {
          const y = index * ROW + 26;
          return (
            <g key={row.label} data-words={words(row)} data-testid="dumbbell-row">
              <text x={SIDE} y={y - 10} className="fill-ink text-[11px]">
                {fitted(row.label)}
              </text>
              <line
                x1={SIDE}
                x2={WIDTH - SIDE}
                y1={y}
                y2={y}
                strokeWidth={1}
                className="stroke-line"
              />
              <line
                x1={x(row.from)}
                x2={x(row.to)}
                y1={y}
                y2={y}
                strokeWidth={2}
                className="stroke-viz-compare"
              />
              <circle cx={x(row.from)} cy={y} r={5} className="cmx-marker fill-viz-compare" />
              <circle cx={x(row.to)} cy={y} r={5} className="cmx-marker fill-viz-1" />
            </g>
          );
        })}
        <text x={SIDE} y={height - 4} className="fill-ink-muted text-[11px]">
          {format(min)}
        </text>
        <text
          x={WIDTH - SIDE}
          y={height - 4}
          textAnchor="end"
          className="fill-ink-muted text-[11px]"
        >
          {format(max)}
        </text>
      </svg>
      <ul className="mt-1 flex gap-3 text-xs text-ink-secondary">
        <li className="flex items-center gap-1">
          <svg width={10} height={10} aria-hidden="true">
            <circle cx={5} cy={5} r={5} className="fill-viz-compare" />
          </svg>
          {fromLabel}
        </li>
        <li className="flex items-center gap-1">
          <svg width={10} height={10} aria-hidden="true">
            <circle cx={5} cy={5} r={5} className="fill-viz-1" />
          </svg>
          {toLabel}
        </li>
      </ul>
    </ChartFrame>
  );
}
