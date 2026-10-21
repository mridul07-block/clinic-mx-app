import { centreOptions, staffRecord } from '@clinic-mx/db';
import { istDayEndingAt, staffRoleLabels } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FormMessage } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { invitePending } from '../../../../../../modules/staff/directory';
import { Tag } from '../../../../../../components/tag';
import { StaffStatus } from '../staff-status';
import { AccountActions } from './account-actions';
import { EditForm } from './edit-form';

export const metadata: Metadata = { title: 'Staff member · Clinic Mx' };

// One staff member (IAM-06): role, ticks, centres and end date; invite, two step reset and
// deactivation. The email is their login and stays as it is. A Velyx support login keeps the
// Super Admin role, so it has no details form; a support viewer sees the page read only (IAM-08).
export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffUserId: string }>;
  searchParams: Promise<{ invited?: string }>;
}) {
  const staff = await requirePermission('staff.manage');
  const { staffUserId } = await params;
  if (!z.guid().safeParse(staffUserId).success) notFound();
  const [member, centres] = await asStaff(staff, (tx) =>
    Promise.all([staffRecord(tx, staffUserId), centreOptions(tx)]),
  );
  if (!member) notFound();
  const pending = await invitePending(member.authUserId);
  const justInvited = (await searchParams).invited === 'sent';
  const self = member.id === staff.id;

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app/staff" className="text-sm text-ink-muted underline underline-offset-2">
          Staff
        </Link>
        <h1 className="text-title font-semibold">{member.name}</h1>
        <p className="text-ink-secondary">
          {staffRoleLabels[member.role]} · {member.email}
        </p>
        <span className="flex flex-wrap gap-1.5">
          {member.velyxSupport ? <Tag tone="outline">Velyx support</Tag> : null}
          <StaffStatus
            active={member.active}
            accessEndsAt={member.accessEndsAt}
            invitePending={pending}
          />
        </span>
      </div>
      {justInvited ? <FormMessage tone="info">Invite sent to {member.email}.</FormMessage> : null}
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : (
        <>
          {member.velyxSupport ? null : (
            <EditForm
              staffUserId={member.id}
              centres={centres}
              roleLocked={self}
              defaults={{
                name: member.name,
                role: member.role,
                treatsPatients: member.treatsPatients,
                consultant: member.consultant,
                centreIds: member.centreIds,
                accessEndsOn: member.accessEndsAt ? istDayEndingAt(member.accessEndsAt) : '',
              }}
            />
          )}
          <AccountActions
            staffUserId={member.id}
            name={member.name}
            active={member.active}
            invitePending={pending}
            hasLogin={Boolean(member.authUserId)}
            self={self}
          />
        </>
      )}
    </main>
  );
}
