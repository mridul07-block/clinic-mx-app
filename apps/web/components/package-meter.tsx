import type { PackageEntry } from '@clinic-mx/db';
import { addDays, formatIstDate, packageStateLabels } from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import { Tag } from './tag';

// The package meter (BIL-08, Frontend Specification: sessions used of total, expiry date and
// reschedules left, for the front desk, physios and Finance; never a price). Staff see a neutral
// bar; an active package within `expiringDays` of its last day is tagged "Expiring".
export function packageMeterText(entry: PackageEntry): string {
  const reschedules =
    entry.reschedulesLeft === 1
      ? '1 reschedule left'
      : `${String(entry.reschedulesLeft)} reschedules left`;
  return [
    `${String(entry.sessionsUsed)} of ${String(entry.sessionsTotal)} used`,
    `Valid until ${formatIstDate(entry.validUntil)}`,
    reschedules,
  ].join(' · ');
}

export function packageTag(
  entry: PackageEntry,
  today: string,
  expiringDays: number,
): { tone: Tone; label: string } {
  if (entry.state === 'active') {
    return entry.validUntil <= addDays(today, expiringDays)
      ? { tone: 'waiting', label: 'Expiring' }
      : { tone: 'done', label: packageStateLabels.active };
  }
  return { tone: 'neutral', label: packageStateLabels[entry.state] };
}

export function PackageMeter({
  entry,
  today,
  expiringDays,
}: {
  entry: PackageEntry;
  today: string;
  expiringDays: number;
}) {
  const tag = packageTag(entry, today, expiringDays);
  return (
    <div
      data-testid="package-meter"
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink">{entry.name}</span>
        <Tag tone={tag.tone}>{tag.label}</Tag>
      </div>
      <div
        role="progressbar"
        aria-label="Sessions used"
        aria-valuemin={0}
        aria-valuemax={entry.sessionsTotal}
        aria-valuenow={entry.sessionsUsed}
        className="h-2 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className="h-full rounded-full bg-ink-secondary"
          style={{ width: `${String((entry.sessionsUsed / entry.sessionsTotal) * 100)}%` }}
        />
      </div>
      <p className="text-sm text-ink-secondary tabular-nums" data-testid="package-meter-text">
        {packageMeterText(entry)}
      </p>
      {entry.state === 'expired' && entry.sessionsLeft > 0 ? (
        <p className="text-sm text-ink-secondary">
          Expired with {entry.sessionsLeft} {entry.sessionsLeft === 1 ? 'session' : 'sessions'}{' '}
          left.
        </p>
      ) : null}
      {entry.state === 'cancelled' && entry.cancelReason ? (
        <p className="text-sm text-ink-secondary">{entry.cancelReason}</p>
      ) : null}
    </div>
  );
}
