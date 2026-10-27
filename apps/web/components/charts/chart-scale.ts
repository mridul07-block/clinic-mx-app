/**
 * Shared arithmetic and colours of the hand-built charts (design system v2 section 9). Colours are
 * whole class names from the tokens, never built at run time.
 */

/** The smallest 1, 2, 2.5 or 5 times a power of ten at or above `value`: a round axis end. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((each) => each * power >= value) ?? 10;
  return step * power;
}

/** Whether a value meets a target, in words for the readout and the table. */
export function targetWords(
  value: number,
  target: number,
  better: 'higher' | 'lower' = 'higher',
): string {
  const met = better === 'higher' ? value >= target : value <= target;
  return met ? 'meets target' : better === 'higher' ? 'below target' : 'above target';
}

export const tones = ['viz-1', 'compare', 'centre-1', 'centre-2', 'centre-3'] as const;

export type Tone = (typeof tones)[number];

export const toneFill: Record<Tone, string> = {
  'viz-1': 'fill-viz-1',
  compare: 'fill-viz-compare',
  'centre-1': 'fill-viz-centre-1',
  'centre-2': 'fill-viz-centre-2',
  'centre-3': 'fill-viz-centre-3',
};

export const toneStroke: Record<Tone, string> = {
  'viz-1': 'stroke-viz-1',
  compare: 'stroke-viz-compare',
  'centre-1': 'stroke-viz-centre-1',
  'centre-2': 'stroke-viz-centre-2',
  'centre-3': 'stroke-viz-centre-3',
};

export const toneBackground: Record<Tone, string> = {
  'viz-1': 'bg-viz-1',
  compare: 'bg-viz-compare',
  'centre-1': 'bg-viz-centre-1',
  'centre-2': 'bg-viz-centre-2',
  'centre-3': 'bg-viz-centre-3',
};

/** The 7 step blue ramp, lightest first. */
export const rampFill = [
  'fill-viz-ramp-1',
  'fill-viz-ramp-2',
  'fill-viz-ramp-3',
  'fill-viz-ramp-4',
  'fill-viz-ramp-5',
  'fill-viz-ramp-6',
  'fill-viz-ramp-7',
] as const;

/** The ramp step (0 to 6) of a value from 0 to `max`; anything above none is at least step 0. */
export function rampStep(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(rampFill.length - 1, Math.max(0, Math.ceil((value / max) * rampFill.length) - 1));
}

/** A safe SVG id from React's `useId`. */
export function svgId(id: string, name: string): string {
  return `${name}${id.replace(/[^a-zA-Z0-9]/g, '')}`;
}
