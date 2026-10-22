import { leaveFor } from '@clinic-mx/db';
import { accessScope, istDate } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FormMessage } from '../../../../../components/forms';
import { asStaff } from '../../../../../modules/access/staff-db';
import { requireStaff } from '../../../../../modules/auth/session';
import { getSetting } from '../../../../../modules/settings/settings';
import { LeaveForm } from './leave-forms';
import { LeaveList } from './leave-list';

export const metadata: Metadata = { title: 'My leave · Clinic Mx' };

const notices: Record<string, string> = {
  requested: 'Leave requested. Your manager will approve or decline it.',
  cancelled: 'Leave cancelled.',
};

// My leave (SET-04): anyone who treats patients requests their own leave (leave.manage, own) and
// sees what was decided. A manager or the Super Admin decides it on Team.
export default async function MyLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requireStaff();
  if (!accessScope(staff, 'leave.manage') || !staff.treatsPatients) redirect('/app/not-allowed');
  const leave = await asStaff(staff, (tx) => leaveFor(tx, staff.id));
  const slotMinutes = await getSetting('scheduling.slot_minutes');
  const notice = notices[(await searchParams).done ?? ''];

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">My leave</h1>
        <p className="text-ink-secondary">
          Request time away. Your Centre Manager or the Super Admin approves it, and patients are
          not booked with you then.
        </p>
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-ink">Request leave</h2>
          <LeaveForm today={istDate(new Date())} slotMinutes={slotMinutes} />
        </section>
      )}
      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <h2 className="font-semibold text-ink">Your leave</h2>
        <LeaveList
          leave={leave}
          cancellable={(entry) => !staff.support && entry.status === 'requested'}
          back="/app/leave"
        />
      </section>
    </main>
  );
}
