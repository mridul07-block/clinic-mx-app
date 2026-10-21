import { accessScope, staffRoleLabels } from '@clinic-mx/schemas';
import Link from 'next/link';
import { requireStaff } from '../../../../modules/auth/session';
import { SignOutButton } from './sign-out-button';

const linkClass = 'text-accent underline underline-offset-2 pointer-coarse:py-3';

// Staff app home at /app. The role landing screens replace this.
export default async function StaffHome() {
  const staff = await requireStaff();
  return (
    <main className="flex flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-title font-semibold">Clinic Mx</h1>
        <p className="text-ink-muted">
          Signed in as {staff.name}, {staffRoleLabels[staff.role]}
        </p>
      </div>
      <nav className="flex flex-col items-start">
        {accessScope(staff, 'staff.manage') ? (
          <Link href="/app/staff" className={linkClass}>
            Staff
          </Link>
        ) : null}
        <Link href="/app/account" className={linkClass}>
          Account
        </Link>
      </nav>
      <div className="w-full max-w-signin">
        <SignOutButton />
      </div>
    </main>
  );
}
