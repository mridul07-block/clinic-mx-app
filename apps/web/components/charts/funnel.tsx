import type { CSSProperties } from 'react';
import { ChartFrame } from './chart-frame';

/**
 * A funnel (Frontend Specification section 8: consultation to completion drop off): one bar per
 * stage in order, each as wide as its share of the first stage, with how many went on from the
 * stage before in words. Bars, not a funnel shape, so every stage is read on one scale.
 */
export function Funnel({
  label,
  stages,
}: {
  label: string;
  stages: readonly { label: string; value: number }[];
}) {
  const first = stages[0]?.value ?? 0;
  const share = (value: number) => (first > 0 ? Math.round((value / first) * 100) : 0);
  const onFrom = (index: number) => {
    const before = stages[index - 1]?.value ?? 0;
    const value = stages[index]?.value ?? 0;
    return before > 0 ? `${String(Math.round((value / before) * 100))}% of the stage before` : '';
  };
  const words = (index: number) => {
    const stage = stages[index];
    if (!stage) return '';
    return [`${stage.label}: ${String(stage.value)}`, index > 0 ? onFrom(index) : null]
      .filter(Boolean)
      .join(', ');
  };
  return (
    <ChartFrame
      label={label}
      table={{
        columns: ['Stage', 'Episodes', 'Of the first', 'Of the stage before'],
        rows: stages.map((stage, index) => [
          stage.label,
          String(stage.value),
          `${String(share(stage.value))}%`,
          index === 0 ? '' : onFrom(index),
        ]),
      }}
    >
      <ol className="flex flex-col gap-2" aria-label={label}>
        {stages.map((stage, index) => (
          <li
            key={String(index)}
            className="flex flex-col gap-1 text-sm"
            data-words={words(index)}
            data-testid="funnel-stage"
          >
            <span className="flex justify-between gap-2">
              <span className="text-ink">{stage.label}</span>
              <span className="tabular-nums text-ink-secondary">
                {stage.value}
                {index > 0 && first > 0 ? `, ${String(share(stage.value))}%` : ''}
              </span>
            </span>
            <span className="h-3 w-full rounded-control bg-surface-sunken">
              <span
                className="cmx-marker block h-3 rounded-control bg-viz-1"
                style={
                  {
                    width: `${String(share(stage.value))}%`,
                    '--cmx-delay': `${String(index * 12)}ms`,
                  } as CSSProperties
                }
              />
            </span>
          </li>
        ))}
      </ol>
    </ChartFrame>
  );
}
