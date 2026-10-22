import { centreColourIndex, centreColourName } from '@clinic-mx/schemas';

// The centre colour tokens (viz-centre-1..3), written out in full so Tailwind sees them.
const swatchClass = ['bg-viz-centre-1', 'bg-viz-centre-2', 'bg-viz-centre-3'];

/** A centre's chart colour: a swatch with its name beside it, never the colour alone. */
export function CentreSwatch({ colour }: { colour: string }) {
  const index = centreColourIndex(colour);
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-secondary">
      <span
        aria-hidden="true"
        className={`size-3 rounded-full border border-line ${swatchClass[index] ?? 'bg-surface-sunken'}`}
      />
      {centreColourName(colour)}
    </span>
  );
}

export { swatchClass };
