import { staffList } from '@clinic-mx/db';
import { seesAllCentres, staffRoleLabels } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { primaryButtonClass } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { loginsWithPendingInvite } from '../../../../../modules/staff/directory';
import { Tag } from '../../../../../components/tag';
import { StaffStatus } from './staff-status';

export const metadata: Metadata = { title: 'Staff · Clinic Mx' };

// Staff management for the Super Admin (IAM-06, PRD M16): everyone, active first. Read as the
// Super Admin under row level security. A Velyx support login sees it read only (IAM-08).
export default async function StaffPage() {
  const staff = await requirePermission('staff.manage');
  const [members, pending] = await Promise.all([
    asStaff(staff, (tx) => staffList(tx)),
    loginsWithPendingInvite(),
  ]);
  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
            Home
          </Link>
          <h1 className="text-title font-semibold">Staff</h1>
        </div>
        {staff.support ? null : (
          <Link href="/app/staff/new" className={[primaryButtonClass, 'sm:w-auto'].join(' ')}>
            Invite staff
          </Link>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
        {members.map((member) => (
          <li key={member.id}>
            <Link
              href={`/app/staff/${member.id}`}
              className="flex flex-col gap-1.5 px-4 py-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">{member.name}</span>
                <span className="text-sm text-ink-muted">
                  {staffRoleLabels[member.role]} ·{' '}
                  {seesAllCentres(member.role)
                    ? 'All centres'
                    : member.centres.join(', ') || 'No centre'}
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {member.velyxSupport ? <Tag tone="outline">Velyx support</Tag> : null}
                <StaffStatus
                  active={member.active}
                  accessEndsAt={member.accessEndsAt}
                  invitePending={member.authUserId ? pending.has(member.authUserId) : false}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
