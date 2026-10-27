import { ChartFrame } from './chart-frame';
import { rampFill, rampStep } from './chart-scale';

/**
 * A heatmap (design system v2 section 9, Frontend Specification section 8: busy hours, day ×
 * hour): one cell per row and column on the 7 step blue ramp, lightest for the fewest, with a key;
 * a cell with no value stays grey. Every cell says its row, column and value.
 */

const WIDTH = 320;
const LEFT = 30;
const TOP = 14;
const CELL_HEIGHT = 20;
const GAP = 2;
/** Where the key's swatches start, after the word "Fewer". */
const KEY_LEFT = 32;

export function Heatmap({
  label,
  columns,
  rows,
  unit,
}: {
  label: string;
  columns: readonly string[];
  rows: readonly { label: string; values: readonly (number | null)[] }[];
  /** What a value counts, for the words: "visits". */
  unit: string;
}) {
  const max = Math.max(0, ...rows.flatMap((row) => row.values.map((value) => value ?? 0)));
  const cellWidth = (WIDTH - LEFT) / Math.max(columns.length, 1);
  const keyTop = TOP + rows.length * CELL_HEIGHT + 10;
  const height = keyTop + 32;
  const every = Math.ceil(columns.length / 7);
  return (
    <ChartFrame
      label={label}
      table={{
        columns: ['', ...columns],
        rows: rows.map((row) => [
          row.label,
          ...columns.map((_, index) => {
            const value = row.values[index] ?? null;
            return value === null ? 'No data' : String(value);
          }),
        ]),
      }}
    >
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(height)}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
      >
        {columns.map((column, index) =>
          index % every === 0 ? (
            <text
              key={column}
              x={LEFT + cellWidth * index + cellWidth / 2}
              y={TOP - 4}
              textAnchor="middle"
              className="fill-ink-muted text-[10px]"
            >
              {column}
            </text>
          ) : null,
        )}
        {rows.map((row, rowIndex) => (
          <g key={row.label}>
            <text
              x={LEFT - 4}
              y={TOP + rowIndex * CELL_HEIGHT + (CELL_HEIGHT - GAP) / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-muted text-[11px]"
            >
              {row.label}
            </text>
            {columns.map((column, index) => {
              const value = row.values[index] ?? null;
              return (
                <rect
                  key={column}
                  x={LEFT + cellWidth * index}
                  y={TOP + rowIndex * CELL_HEIGHT}
                  width={cellWidth - GAP}
                  height={CELL_HEIGHT - GAP}
                  rx={2}
                  className={
                    value === null
                      ? 'fill-surface stroke-line-control'
                      : rampFill[rampStep(value, max)]
                  }
                  strokeWidth={value === null ? 1 : undefined}
                  strokeDasharray={value === null ? '2 2' : undefined}
                  data-words={`${row.label} ${column}: ${value === null ? 'no data' : `${String(value)} ${unit}`}`}
                  data-testid="heat-cell"
                  data-step={value === null ? 'none' : String(rampStep(value, max))}
                />
              );
            })}
          </g>
        ))}
        <text x={0} y={keyTop + 9} className="fill-ink-muted text-[10px]">
          Fewer
        </text>
        {rampFill.map((fill, index) => (
          <rect
            key={fill}
            x={KEY_LEFT + index * 16}
            y={keyTop}
            width={14}
            height={12}
            rx={2}
            className={fill}
          />
        ))}
        <text
          x={KEY_LEFT + rampFill.length * 16 + 2}
          y={keyTop + 9}
          className="fill-ink-muted text-[10px]"
        >
          More (up to {max} {unit})
        </text>
        <rect
          x={KEY_LEFT}
          y={keyTop + 16}
          width={14}
          height={12}
          rx={2}
          strokeWidth={1}
          strokeDasharray="2 2"
          className="fill-surface stroke-line-control"
        />
        <text x={KEY_LEFT + 18} y={keyTop + 25} className="fill-ink-muted text-[10px]">
          No data
        </text>
      </svg>
    </ChartFrame>
  );
}
