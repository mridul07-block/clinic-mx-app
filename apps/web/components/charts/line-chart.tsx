/**
 * A line chart (design system v2 section 9): one series in `viz-1`, horizontal gridlines only,
 * axis labels never rotated, each point labelled directly, a gap where there is no value, the line
 * drawn once when it first shows. Hand-built SVG; it scales to its container, 360 px first.
 */

const WIDTH = 320;
const HEIGHT = 160;
const LEFT = 24;
const RIGHT = 12;
const TOP = 18;
const BOTTOM = 24;

export interface LinePoint {
  label: string;
  value: number | null;
}

export function LineChart({
  label,
  points,
  min,
  max,
  target,
  band,
}: {
  /** What the chart says, for screen readers. */
  label: string;
  points: readonly LinePoint[];
  min: number;
  max: number;
  /** A 1 px dashed target line, labelled at its end ("Target 75%", DSH-02). */
  target?: { value: number; label: string };
  /** A shaded band, such as a questionnaire's meaningful change (DSH-02). */
  band?: { from: number; to: number; label: string };
}) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const x = (index: number) =>
    LEFT + (points.length === 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1));
  const y = (value: number) => TOP + plotHeight - ((value - min) / (max - min)) * plotHeight;
  // One path per run of points with values: a missing value leaves a gap.
  const runs: { index: number; value: number }[][] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      runs.push([]);
      return;
    }
    const run = runs.at(-1);
    if (run) run.push({ index, value: point.value });
    else runs.push([{ index, value: point.value }]);
  });
  const ticks = [min, (min + max) / 2, max];
  const first = points[0];
  const last = points.at(-1);
  return (
    <svg
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      role="img"
      aria-label={label}
      className="h-auto w-full"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-line"
            strokeWidth={1}
          />
          <text
            x={LEFT - 6}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-ink-muted text-[11px]"
          >
            {tick}
          </text>
        </g>
      ))}
      {band ? (
        <g data-testid="line-band">
          <rect
            x={LEFT}
            y={y(Math.max(band.from, band.to))}
            width={WIDTH - LEFT - RIGHT}
            height={Math.abs(y(band.from) - y(band.to))}
            className="fill-viz-ramp-1"
          />
          <text
            x={WIDTH - RIGHT - 4}
            y={y(Math.min(band.from, band.to)) - 3}
            textAnchor="end"
            paintOrder="stroke"
            strokeWidth={3}
            strokeLinejoin="round"
            className="fill-ink-muted stroke-canvas text-[10px]"
          >
            {band.label}
          </text>
        </g>
      ) : null}
      {target ? (
        <g data-testid="line-target">
          <line
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={y(target.value)}
            y2={y(target.value)}
            strokeWidth={1}
            strokeDasharray="4 3"
            className="stroke-viz-target"
          />
          <text
            x={WIDTH - RIGHT}
            y={y(target.value) + 11}
            textAnchor="end"
            paintOrder="stroke"
            strokeWidth={3}
            strokeLinejoin="round"
            className="fill-ink-muted stroke-canvas text-[10px]"
          >
            {target.label}
          </text>
        </g>
      ) : null}
      {runs
        .filter((run) => run.length > 1)
        .map((run) => (
          <path
            key={run.map((p) => String(p.index)).join('-')}
            d={run
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${String(x(p.index))},${String(y(p.value))}`)
              .join(' ')}
            pathLength={1}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            className="cmx-line stroke-viz-1"
          />
        ))}
      {points.map((point, index) =>
        point.value === null ? null : (
          <g
            key={[String(index), point.label].join('-')}
            data-testid="line-point"
            data-words={`${point.label}: ${String(point.value)}`}
          >
            <circle cx={x(index)} cy={y(point.value)} r={3.5} className="cmx-marker fill-viz-1" />
            <text
              x={x(index)}
              y={y(point.value) - 8}
              textAnchor="middle"
              className="fill-ink text-[11px] font-medium"
            >
              {point.value}
            </text>
          </g>
        ),
      )}
      {first ? (
        <text
          x={x(0)}
          y={HEIGHT - 6}
          textAnchor={points.length === 1 ? 'middle' : 'start'}
          className="fill-ink-muted text-[11px]"
        >
          {first.label}
        </text>
      ) : null}
      {last && points.length > 1 ? (
        <text
          x={x(points.length - 1)}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-ink-muted text-[11px]"
        >
          {last.label}
        </text>
      ) : null}
    </svg>
  );
}
