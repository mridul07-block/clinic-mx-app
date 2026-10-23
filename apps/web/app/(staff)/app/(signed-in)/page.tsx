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
        {accessScope(staff, 'check_in.manage') ? (
          <Link href="/app/today" className={linkClass}>
            Today
          </Link>
        ) : null}
        {accessScope(staff, 'calendar.view') ? (
          <Link href="/app/calendar" className={linkClass}>
            Calendar
          </Link>
        ) : null}
        {accessScope(staff, 'patients.view_contact') ? (
          <Link href="/app/patients" className={linkClass}>
            Patients
          </Link>
        ) : null}
        {accessScope(staff, 'centres.manage') ? (
          <Link href="/app/centres" className={linkClass}>
            Centres
          </Link>
        ) : null}
        {accessScope(staff, 'rosters.manage') ? (
          <Link href="/app/team" className={linkClass}>
            Team
          </Link>
        ) : null}
        {accessScope(staff, 'leave.manage') && staff.treatsPatients ? (
          <Link href="/app/leave" className={linkClass}>
            My leave
          </Link>
        ) : null}
        {accessScope(staff, 'settings.manage') ? (
          <Link href="/app/appointment-types" className={linkClass}>
            Appointment types
          </Link>
        ) : null}
        {accessScope(staff, 'red_flags.view') ? (
          <Link href="/app/alerts" className={linkClass}>
            Alerts
          </Link>
        ) : null}
        {accessScope(staff, 'knowledge_base.view') ? (
          <Link href="/app/red-flags" className={linkClass}>
            Red flags
          </Link>
        ) : null}
        {accessScope(staff, 'prices.view') ? (
          <Link href="/app/prices" className={linkClass}>
            Prices
          </Link>
        ) : null}
        {accessScope(staff, 'staff.manage') ? (
          <Link href="/app/staff" className={linkClass}>
            Staff
          </Link>
        ) : null}
        {accessScope(staff, 'support_access.grant') ? (
          <Link href="/app/support-access" className={linkClass}>
            Support access
          </Link>
        ) : null}
        {accessScope(staff, 'check_in.manage') ? (
          <Link href="/app/kiosk-tablets" className={linkClass}>
            Kiosk tablets
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
