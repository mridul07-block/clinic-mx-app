import { ChartFrame } from './chart-frame';

/**
 * A donut (design system v2 section 9, Frontend Specification section 8): only for one whole in 2
 * to 4 parts, never for change over time; the total or a score in the centre; every part named
 * beside it with its count and share. Parts are separated by a small gap.
 */

const SIZE = 140;
const RADIUS = 52;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 2;

export const donutTones = [
  'viz-1',
  'compare',
  'promoter',
  'passive',
  'detractor',
  'centre-1',
  'centre-2',
  'centre-3',
] as const;

export type DonutTone = (typeof donutTones)[number];

const stroke: Record<DonutTone, string> = {
  'viz-1': 'stroke-viz-1',
  compare: 'stroke-viz-compare',
  promoter: 'stroke-viz-promoter',
  passive: 'stroke-viz-passive',
  detractor: 'stroke-viz-detractor',
  'centre-1': 'stroke-viz-centre-1',
  'centre-2': 'stroke-viz-centre-2',
  'centre-3': 'stroke-viz-centre-3',
};

const swatch: Record<DonutTone, string> = {
  'viz-1': 'fill-viz-1',
  compare: 'fill-viz-compare',
  promoter: 'fill-viz-promoter',
  passive: 'fill-viz-passive',
  detractor: 'fill-viz-detractor',
  'centre-1': 'fill-viz-centre-1',
  'centre-2': 'fill-viz-centre-2',
  'centre-3': 'fill-viz-centre-3',
};

export interface DonutPart {
  label: string;
  value: number;
  tone: DonutTone;
}

export function DonutChart({
  label,
  parts,
  centre,
  centreCaption,
}: {
  label: string;
  parts: readonly DonutPart[];
  /** What the middle says: the total, or a score such as the NPS. */
  centre: string;
  centreCaption: string;
}) {
  if (parts.length < 2 || parts.length > 4) {
    throw new Error(`A donut shows one whole in 2 to 4 parts, not ${String(parts.length)}.`);
  }
  const total = parts.reduce((sum, part) => sum + Math.max(part.value, 0), 0);
  const share = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const words = (part: DonutPart) =>
    `${part.label}: ${String(part.value)} (${String(share(part.value))}%)`;
  let start = 0;
  return (
    <ChartFrame
      label={label}
      table={{
        columns: ['Part', 'Count', 'Share'],
        rows: parts.map((part) => [
          part.label,
          String(part.value),
          `${String(share(part.value))}%`,
        ]),
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <svg
          viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
          role="img"
          aria-label={label}
          className="h-auto w-36 shrink-0"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-surface-sunken"
          />
          {total > 0
            ? parts.map((part, index) => {
                const length = (Math.max(part.value, 0) / total) * CIRCUMFERENCE;
                const drawn = Math.max(length - (length > GAP * 2 ? GAP : 0), 0);
                const offset = -start;
                start += length;
                return (
                  <circle
                    key={part.label}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    strokeWidth={STROKE}
                    strokeDasharray={`${String(drawn)} ${String(CIRCUMFERENCE - drawn)}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${String(SIZE / 2)} ${String(SIZE / 2)})`}
                    className={`cmx-marker cmx-arc ${stroke[part.tone]}`}
                    data-words={words(part)}
                    data-mark={String(index)}
                    data-testid="donut-part"
                  />
                );
              })
            : null}
          <text
            x={SIZE / 2}
            y={SIZE / 2 - 2}
            textAnchor="middle"
            className="fill-ink text-[22px] font-semibold"
          >
            {centre}
          </text>
          <text
            x={SIZE / 2}
            y={SIZE / 2 + 16}
            textAnchor="middle"
            className="fill-ink-muted text-[11px]"
          >
            {centreCaption}
          </text>
        </svg>
        <ul className="flex flex-col gap-1.5 text-sm">
          {parts.map((part, index) => (
            <li
              key={part.label}
              className="flex cursor-pointer items-center gap-2"
              data-for={String(index)}
            >
              <svg width={10} height={10} aria-hidden="true">
                <rect width={10} height={10} rx={2} className={swatch[part.tone]} />
              </svg>
              <span className="text-ink">{part.label}</span>
              <span className="tabular-nums text-ink-secondary">
                {part.value}, {share(part.value)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}
