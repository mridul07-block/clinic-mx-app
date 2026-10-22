import type { LeaveEntry } from '@clinic-mx/db';
import { formatLeave } from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import { Tag } from '../../../../../components/tag';
import { CancelLeaveForm } from './leave-forms';

const statusTag: Record<LeaveEntry['status'], { tone: Tone; label: string }> = {
  requested: { tone: 'waiting', label: 'Waiting for a decision' },
  approved: { tone: 'done', label: 'Approved' },
  declined: { tone: 'danger', label: 'Declined' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

/**
 * A person's leave with its status (SET-04). `cancellable` says which entries offer Cancel:
 * requested ones for the person, requested or approved ones for their manager.
 */
export function LeaveList({
  leave,
  cancellable,
  back,
}: {
  leave: LeaveEntry[];
  cancellable: (entry: LeaveEntry) => boolean;
  back: string;
}) {
  if (leave.length === 0) return <p className="text-ink-secondary">No leave yet.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {leave.map((entry) => {
        const tag = statusTag[entry.status];
        return (
          <li
            key={entry.id}
            data-testid="leave"
            className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink tabular-nums">
                {formatLeave(entry.startsAt, entry.endsAt, entry.allDay)}
              </span>
              <Tag tone={tag.tone}>{tag.label}</Tag>
            </span>
            {entry.note ? <span className="text-sm text-ink-secondary">{entry.note}</span> : null}
            {entry.declineReason ? (
              <span className="text-sm text-ink-secondary">Reason: {entry.declineReason}</span>
            ) : null}
            {cancellable(entry) ? <CancelLeaveForm leaveId={entry.id} back={back} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
