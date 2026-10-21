import { centreOptions } from '@clinic-mx/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Invite staff · Clinic Mx' };

// Invite a staff member (IAM-06): their details, then an invite email that links to our domain
// to set a password, or a link to share when the email cannot be sent.
export default async function InviteStaffPage() {
  const staff = await requirePermission('staff.manage');
  const centres = staff.support ? [] : await asStaff(staff, (tx) => centreOptions(tx));
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app/staff" className="text-sm text-ink-muted underline underline-offset-2">
          Staff
        </Link>
        <h1 className="text-title font-semibold">Invite staff</h1>
      </div>
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : (
        <InviteForm centres={centres} />
      )}
    </main>
  );
}
