import { kpiStatusLabels } from '@clinic-mx/schemas';
import type { OutcomeBullet } from '../../modules/reporting/manager';
import { BulletGraph } from '../charts/bullet-graph';

const statusClass = {
  on_target: 'text-active',
  off_target: 'text-waiting',
  no_data: 'text-ink-muted',
} as const;

/**
 * One SOP target as a bullet graph with its value, status word and count, or what brings it when
 * it is not measured yet (DSH-03, DSH-05).
 */
export function OutcomeBulletCard({ bullet }: { bullet: OutcomeBullet }) {
  return (
    <li
      className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4"
      data-testid="outcome-bullet"
      data-figure={bullet.key}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{bullet.label}</span>
        <span className="text-sm text-ink-secondary">Target: {bullet.targetText}</span>
      </span>
      {bullet.needs ? (
        <p className="text-sm text-ink-secondary">Not measured yet: {bullet.needs}</p>
      ) : bullet.value === null ? (
        <p className="text-sm text-ink-muted">No data yet in this window.</p>
      ) : (
        <>
          <span className="flex items-baseline gap-2">
            <span className="text-title font-semibold tabular-nums text-ink">
              {Math.round(bullet.value)}%
            </span>
            {bullet.status ? (
              <span className={`text-sm ${statusClass[bullet.status]}`}>
                {kpiStatusLabels[bullet.status]}
              </span>
            ) : null}
          </span>
          <BulletGraph
            label={`${bullet.label} ${String(Math.round(bullet.value))}% against a target of ${bullet.targetText.toLowerCase()}`}
            value={bullet.value}
            target={bullet.target}
            earlier={bullet.earlier}
            max={100}
            targetLabel={`Target ${bullet.targetText.toLowerCase()}`}
            lowerIsBetter={bullet.lowerIsBetter}
          />
          <span className="text-xs text-ink-muted">
            {bullet.counted}
            {bullet.earlier === null
              ? ''
              : `; the grey mark is the window before, ${String(Math.round(bullet.earlier))}%`}
          </span>
        </>
      )}
    </li>
  );
}
