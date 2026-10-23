import { bodyChartViewLabels, bodyChartViews, bodyChartZones } from '@clinic-mx/schemas';

// The body chart (INT-05, Frontend Specification §5): front and back outlines with a box to tick
// for each zone. Plain checkboxes, so it works without scripts; each box is named for screen
// readers ("Right knee, front"). On the front the patient's right is on the viewer's left.

/** The outline, on the zones' 100 by 200 grid; the right side mirrors the left. */
function Outline() {
  const side = (mirror: boolean) => (
    <g transform={mirror ? 'translate(100 0) scale(-1 1)' : undefined}>
      <rect x="19" y="28" width="12" height="32" rx="6" />
      <rect x="16" y="59" width="12" height="31" rx="6" />
      <ellipse cx="20" cy="97" rx="6" ry="8" />
      <rect x="33" y="84" width="16" height="54" rx="7" />
      <rect x="35" y="136" width="13" height="44" rx="6" />
      <ellipse cx="41" cy="185" rx="8" ry="6" />
    </g>
  );
  return (
    <svg
      viewBox="0 0 100 200"
      aria-hidden="true"
      className="absolute inset-0 size-full fill-surface-sunken stroke-line-strong"
      strokeWidth="0.8"
    >
      <circle cx="50" cy="10" r="8" />
      <rect x="44" y="17" width="12" height="9" rx="3" />
      <rect x="30" y="25" width="40" height="63" rx="9" />
      {side(false)}
      {side(true)}
    </svg>
  );
}

export function BodyChart({
  name,
  chosen,
  describedBy,
}: {
  name: string;
  chosen: readonly string[];
  describedBy?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-6" aria-describedby={describedBy}>
      {bodyChartViews.map((view) => (
        <figure key={view} className="flex w-full max-w-64 flex-col gap-2">
          <figcaption className="flex justify-between text-sm text-ink-secondary">
            <span>{view === 'front' ? 'Right' : 'Left'}</span>
            <span className="font-medium text-ink">{bodyChartViewLabels[view]}</span>
            <span>{view === 'front' ? 'Left' : 'Right'}</span>
          </figcaption>
          <div className="relative aspect-[1/2] w-full">
            <Outline />
            {bodyChartZones
              .filter((zone) => zone.view === view)
              .map((zone) => (
                <label
                  key={zone.key}
                  title={zone.label}
                  className="absolute cursor-pointer rounded-md border border-dashed border-line-control/60 has-[:checked]:border-solid has-[:checked]:border-brand-deep has-[:checked]:bg-brand/70 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
                  style={{
                    left: `${String(zone.x)}%`,
                    top: `${String(zone.y / 2)}%`,
                    width: `${String(zone.w)}%`,
                    height: `${String(zone.h / 2)}%`,
                  }}
                >
                  <input
                    type="checkbox"
                    name={name}
                    value={zone.key}
                    defaultChecked={chosen.includes(zone.key)}
                    aria-label={zone.label}
                    className="sr-only"
                  />
                </label>
              ))}
          </div>
        </figure>
      ))}
    </div>
  );
}
