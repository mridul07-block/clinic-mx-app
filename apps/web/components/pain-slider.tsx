'use client';

import { useId } from 'react';

/**
 * The pain slider (Frontend Specification: "0 to 10 with large thumb and number readout"), for
 * staff screens: unset until touched, then the number it reads. Read only shows the reading.
 */
export function PainSlider({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  readOnly?: boolean;
}) {
  const id = useId();
  const readout = value === null ? 'Not set yet' : `${String(value)} out of 10`;
  return (
    <div className="flex flex-col gap-1.5" data-testid="pain-slider">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-medium text-ink">
          {label}
        </label>
        <span
          className={`text-lg font-semibold tabular-nums ${value === null ? 'text-ink-muted' : 'text-ink'}`}
          aria-hidden="true"
          data-testid="pain-readout"
        >
          {value === null ? 'Not set' : String(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={10}
        step={1}
        disabled={readOnly}
        value={value ?? 5}
        aria-valuetext={readout}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
        onPointerDown={(event) => {
          if (value === null) onChange(Number(event.currentTarget.value));
        }}
        data-untouched={value === null ? '' : undefined}
        className="h-12 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default data-[untouched]:opacity-60 [&::-moz-range-thumb]:size-9 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-line [&::-webkit-slider-thumb]:-mt-3.5 [&::-webkit-slider-thumb]:size-9 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
      />
      <div className="flex justify-between text-sm text-ink-secondary" aria-hidden="true">
        <span>0 No pain</span>
        <span>10 Worst pain</span>
      </div>
    </div>
  );
}
