import { navigationFor, staffRoleLabels } from '@clinic-mx/schemas';
import Link from 'next/link';
import { requireStaff } from '../../../../modules/auth/session';
import { openTasksOf } from '../../../../modules/tasks/services';
import { SignOutButton } from './sign-out-button';

const linkClass = 'text-accent underline underline-offset-2 pointer-coarse:py-3';

/** Links tests find by id (their words change with counts). */
const homeTestIds: Record<string, string> = {
  '/app/tasks': 'home-tasks',
  '/app/my-patients': 'home-my-patients',
};

// Staff app home at /app: every screen the person may open (`navigationFor`, UI-02), the same list
// as the rail and sidebar, then Account and signing out. The role landing screens open first.
export default async function StaffHome() {
  const staff = await requireStaff();
  const openTasks = await openTasksOf(staff);
  return (
    <main className="flex flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-title font-semibold">Clinic Mx</h1>
        <p className="text-ink-muted">
          Signed in as {staff.name}, {staffRoleLabels[staff.role]}
        </p>
      </div>
      <nav aria-label="Screens" className="flex flex-col items-start">
        {navigationFor(staff).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={linkClass}
            data-testid={homeTestIds[item.href]}
          >
            {item.href === '/app/tasks' && openTasks > 0
              ? `${item.label} (${String(openTasks)} open)`
              : item.label}
          </Link>
        ))}
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
