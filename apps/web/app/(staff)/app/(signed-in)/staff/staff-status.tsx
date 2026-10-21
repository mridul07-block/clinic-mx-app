import { formatIstDate, istDayEndingAt } from '@clinic-mx/schemas';
import { Tag } from '../../../../../components/tag';

interface StaffStatusProps {
  active: boolean;
  accessEndsAt: Date | null;
  invitePending: boolean;
  now?: Date;
}

/** Where a staff member's access stands, in words (IAM-06). */
export function StaffStatus({
  active,
  accessEndsAt,
  invitePending,
  now = new Date(),
}: StaffStatusProps) {
  const ended = accessEndsAt !== null && accessEndsAt <= now;
  // In a wrapping row, so tags keep their own width inside stacked layouts.
  return (
    <span className="flex flex-wrap gap-1.5">
      {!active ? (
        <Tag tone="done">Deactivated</Tag>
      ) : ended ? (
        <Tag tone="done">Access ended</Tag>
      ) : (
        <>
          <Tag tone={invitePending ? 'info' : 'active'}>
            {invitePending ? 'Invite sent' : 'Active'}
          </Tag>
          {accessEndsAt ? (
            <Tag tone="waiting">Access ends {formatIstDate(istDayEndingAt(accessEndsAt))}</Tag>
          ) : null}
        </>
      )}
    </span>
  );
}
