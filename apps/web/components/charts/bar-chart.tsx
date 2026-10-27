import { useId, type CSSProperties } from 'react';
import { ChartFrame } from './chart-frame';
import { niceMax, svgId, targetWords, toneFill, toneStroke, tones, type Tone } from './chart-scale';

/**
 * A bar chart (design system v2 section 9): columns from zero, horizontal gridlines only, axis
 * labels never rotated; one series in `viz-1`, a comparison (last year) in grey, centres in their
 * colours; a period still filling up hatched and labelled "so far" (the comparison, already
 * complete, never is); an optional dashed target labelled at its end. Values are written on the
 * bars only where they fit. Bars rise once when the chart first shows. Hand-built SVG, 360 px first.
 */

const WIDTH = 320;
const HEIGHT = 180;
const RIGHT = 6;
const TOP = 16;
// Room for the category labels, and a second line for "so far".
const BOTTOM = 32;
/** About how wide one character is, in viewBox units, at 10 px and 11 px. */
const CHAR_10 = 5.6;
const CHAR_11 = 6;

/** A label centred on `x`, or held inside the chart when centring would cut it off at an edge. */
function edgeSafe(x: number, width: number): { x: number; textAnchor: 'start' | 'middle' | 'end' } {
  if (x + width / 2 > WIDTH) return { x: WIDTH, textAnchor: 'end' };
  if (x - width / 2 < 0) return { x: 0, textAnchor: 'start' };
  return { x, textAnchor: 'middle' };
}

export interface BarSeries {
  name: string;
  tone: Tone;
  values: readonly (number | null)[];
}

export function BarChart({
  label,
  categories,
  series,
  soFar,
  target,
  format = String,
}: {
  label: string;
  categories: readonly string[];
  series: readonly BarSeries[];
  /** The index of the category still filling up (this week, this month). */
  soFar?: number;
  target?: { value: number; label: string; better?: 'higher' | 'lower' };
  format?: (value: number) => string;
}) {
  const id = useId();
  const hatch = (tone: Tone) => svgId(id, `hatch${String(tones.indexOf(tone))}`);
  const clip = svgId(id, 'plot');
  const highest = Math.max(
    target?.value ?? 0,
    ...series.flatMap((each) => each.values.map((value) => value ?? 0)),
  );
  const top = niceMax(highest);
  const ticks = [0, top / 2, top];
  // Room on the left for the longest tick label.
  const axis = 8 + Math.max(...ticks.map((tick) => format(tick).length)) * CHAR_11;
  const plotWidth = WIDTH - axis - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const baseline = TOP + plotHeight;
  const group = plotWidth / Math.max(categories.length, 1);
  const barWidth = (group * 0.72) / Math.max(series.length, 1);
  const y = (value: number) => baseline - (Math.max(value, 0) / top) * plotHeight;
  // Labels never rotate: past 7 categories every few are named, evenly from the first.
  const every = Math.ceil(categories.length / 7);
  const single = series.length === 1;
  const widest = Math.max(
    0,
    ...series.flatMap((each) =>
      each.values.map((value) => (value === null ? 0 : format(value).length)),
    ),
  );
  // A value is written on its bar only when every value fits its column.
  const valuesFit = single && widest * CHAR_10 + 4 <= group;
  /** The comparison (last year) is complete; every other series is still filling in `soFar`. */
  const filling = (index: number, each: BarSeries) => index === soFar && each.tone !== 'compare';
  const words = (index: number, each: BarSeries, value: number) =>
    [
      `${categories[index] ?? ''}${single ? '' : `, ${each.name}`}: ${format(value)}`,
      filling(index, each) ? 'so far' : null,
      target ? targetWords(value, target.value, target.better) : null,
    ]
      .filter(Boolean)
      .join(', ');
  const hatched = [...new Set(series.map((each) => each.tone))].filter(
    (tone) => tone !== 'compare',
  );

  return (
    <ChartFrame
      label={label}
      table={{
        columns: ['', ...series.map((each) => each.name)],
        rows: categories.map((category, index) => [
          index === soFar ? `${category} (so far)` : category,
          ...series.map((each) => {
            const value = each.values[index] ?? null;
            if (value === null) return 'No data';
            return target
              ? `${format(value)}, ${targetWords(value, target.value, target.better)}`
              : format(value);
          }),
        ]),
      }}
    >
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
      >
        <defs>
          <clipPath id={clip}>
            <rect x={0} y={0} width={WIDTH} height={baseline} />
          </clipPath>
          {hatched.map((tone) => (
            <pattern
              key={tone}
              id={hatch(tone)}
              patternUnits="userSpaceOnUse"
              width={5}
              height={5}
              patternTransform="rotate(45)"
            >
              <rect width={5} height={5} className="fill-surface" />
              <line x1={0} y1={0} x2={0} y2={5} strokeWidth={3} className={toneStroke[tone]} />
            </pattern>
          ))}
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={axis}
              x2={WIDTH - RIGHT}
              y1={y(tick)}
              y2={y(tick)}
              strokeWidth={1}
              className="stroke-line"
            />
            <text
              x={axis - 4}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink-muted text-[11px]"
            >
              {format(tick)}
            </text>
          </g>
        ))}
        {categories.map((category, index) => {
          const left = axis + group * index + group * 0.14;
          const middle = left + (barWidth * series.length) / 2;
          return (
            // Labels may repeat (two "Mon"s in a fortnight), so the place is the key.
            <g key={String(index)}>
              {series.map((each, place) => {
                const value = each.values[index] ?? null;
                if (value === null) return null;
                // Drawn from the baseline; a negative value has no bar (its value is in the table).
                const height = value > 0 ? Math.max((value / top) * plotHeight, 1) : 0;
                const x = left + barWidth * place;
                const current = filling(index, each);
                return (
                  <g key={String(place)}>
                    <g clipPath={`url(#${clip})`}>
                      <rect
                        x={x}
                        y={baseline - height}
                        width={Math.max(barWidth - 1, 1)}
                        height={height}
                        rx={1}
                        fill={current ? `url(#${hatch(each.tone)})` : undefined}
                        strokeWidth={current ? 1 : undefined}
                        className={`cmx-bar ${current ? toneStroke[each.tone] : toneFill[each.tone]}`}
                        style={
                          {
                            '--cmx-bar-from': `${String(height)}px`,
                            '--cmx-delay': `${String(index * 12)}ms`,
                          } as CSSProperties
                        }
                        data-words={words(index, each, value)}
                        data-testid={current ? 'bar-so-far' : 'bar'}
                      />
                    </g>
                    {valuesFit && value >= 0 ? (
                      <text
                        x={x + barWidth / 2}
                        y={baseline - height - 3}
                        textAnchor="middle"
                        paintOrder="stroke"
                        strokeWidth={3}
                        strokeLinejoin="round"
                        className="fill-ink stroke-canvas text-[10px] font-medium"
                        data-testid="bar-value"
                      >
                        {format(value)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {index % every === 0 ? (
                <text
                  {...edgeSafe(middle, category.length * CHAR_11)}
                  y={HEIGHT - 17}
                  className="fill-ink-muted text-[11px]"
                >
                  {category}
                </text>
              ) : null}
              {index === soFar ? (
                <text
                  {...edgeSafe(middle, 'so far'.length * CHAR_10)}
                  y={HEIGHT - 4}
                  className="fill-ink-muted text-[10px]"
                >
                  so far
                </text>
              ) : null}
            </g>
          );
        })}
        {target ? (
          <g data-testid="bar-target">
            <line
              x1={axis}
              x2={WIDTH - RIGHT}
              y1={y(target.value)}
              y2={y(target.value)}
              strokeWidth={1}
              strokeDasharray="4 3"
              className="stroke-viz-target"
            />
            <text
              x={WIDTH - RIGHT}
              y={y(target.value) - 4}
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
      </svg>
      {series.length > 1 ? (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-secondary">
          {series.map((each) => (
            <li key={each.name} className="flex items-center gap-1">
              <svg width={10} height={10} aria-hidden="true">
                <rect width={10} height={10} rx={2} className={toneFill[each.tone]} />
              </svg>
              {each.name}
            </li>
          ))}
        </ul>
      ) : null}
    </ChartFrame>
  );
}
