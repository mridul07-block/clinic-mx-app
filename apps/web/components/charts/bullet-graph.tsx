/**
 * A bullet graph (design system v2 section 9, Stephen Few's): the measure as a bar in `viz-1`, the
 * target as a tick in `viz-target` labelled at its end, an earlier value as a small grey mark, on a
 * grey band. Hand-built SVG; it scales to its container.
 */

const WIDTH = 320;
// The target's label on its own row above the band, the earlier mark on its own row below.
const HEIGHT = 50;
const BAND_TOP = 14;
const BAND_HEIGHT = 22;
const BAR_TOP = BAND_TOP + 5;
const BAR_HEIGHT = 12;

export function BulletGraph({
  label,
  value,
  target,
  earlier,
  max,
  targetLabel,
}: {
  label: string;
  value: number;
  target: number;
  earlier: number | null;
  max: number;
  targetLabel: string;
}) {
  const x = (v: number) => (Math.min(Math.max(v, 0), max) / max) * WIDTH;
  return (
    <svg
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      role="img"
      aria-label={label}
      className="h-auto w-full"
    >
      <rect x={0} y={BAND_TOP} width={WIDTH} height={BAND_HEIGHT} className="fill-surface-sunken" />
      <rect
        x={0}
        y={BAR_TOP}
        width={x(value)}
        height={BAR_HEIGHT}
        className="cmx-marker fill-viz-1"
        data-testid="bullet-bar"
      />
      {earlier === null ? null : (
        <rect
          x={x(earlier) - 1.5}
          y={BAND_TOP + BAND_HEIGHT + 3}
          width={3}
          height={8}
          className="fill-viz-compare"
          data-testid="bullet-earlier"
        />
      )}
      <line
        x1={x(target)}
        x2={x(target)}
        y1={BAND_TOP}
        y2={BAND_TOP + BAND_HEIGHT}
        strokeWidth={2}
        className="stroke-viz-target"
      />
      <text
        x={x(target) + (x(target) > WIDTH - 70 ? -4 : 4)}
        y={BAND_TOP - 4}
        textAnchor={x(target) > WIDTH - 70 ? 'end' : 'start'}
        className="fill-ink-muted text-[10px]"
      >
        {targetLabel}
      </text>
    </svg>
  );
}
