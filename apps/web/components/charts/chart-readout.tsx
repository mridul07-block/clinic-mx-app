'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';

const KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/**
 * A chart's value readout (design system v2 section 9: a tooltip, and arrow-key access to the
 * values): the marks of the chart inside carry their value in words (`data-words`); hovering,
 * tapping or arrowing to one shows it on the line above, so a phone needs no floating tooltip.
 * A key (a legend line) names its mark with `data-for`, the mark's `data-mark`, so each value is
 * one stop for the arrow keys. The chart itself stays server rendered.
 */
export function ChartReadout({ label, children }: { label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [words, setWords] = useState<string | null>(null);
  const marks = () => [...(box.current?.querySelectorAll('[data-words]') ?? [])];
  const show = (mark: Element | null | undefined) => {
    for (const each of marks()) each.removeAttribute('data-active');
    if (!mark) {
      setWords(null);
      return;
    }
    mark.setAttribute('data-active', '');
    setWords(mark.getAttribute('data-words'));
  };
  const markOf = (event: SyntheticEvent) => {
    if (!(event.target instanceof Element)) return null;
    const key = event.target.closest('[data-for]')?.getAttribute('data-for');
    if (key !== undefined && key !== null) {
      return box.current?.querySelector(`[data-mark="${CSS.escape(key)}"]`) ?? null;
    }
    return event.target.closest('[data-words]');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!KEYS.includes(event.key)) return;
    event.preventDefault();
    const all = marks();
    const current = all.findIndex((mark) => mark.hasAttribute('data-active'));
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? all.length - 1
          : current === -1
            ? 0
            : Math.min(Math.max(current + step, 0), all.length - 1);
    show(all[next]);
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="min-h-5 text-sm text-ink" aria-live="polite" data-testid="chart-readout">
        {words ?? <span className="text-ink-muted">Tap a mark, or use the arrow keys.</span>}
      </p>
      <div
        ref={box}
        role="group"
        tabIndex={0}
        aria-label={`${label}: arrow keys move between the values`}
        className="rounded-control"
        onKeyDown={onKeyDown}
        onPointerOver={(event) => {
          const mark = markOf(event);
          if (mark) show(mark);
        }}
        onClick={(event) => {
          show(markOf(event));
        }}
      >
        {children}
      </div>
    </div>
  );
}
