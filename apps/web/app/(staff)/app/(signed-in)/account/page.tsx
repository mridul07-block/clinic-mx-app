import { staffRoleLabels, twoStepRequired } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage, primaryButtonClass } from '../../../../../components/forms';
import { requireStaff, signInState } from '../../../../../modules/auth/session';
import { SignOutButton } from '../sign-out-button';

export const metadata: Metadata = { title: 'Account · Clinic Mx' };

// The signed in staff member's own account (IAM-02): who they are, and two step verification,
// which Front Desk can turn on here.
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ 'two-step'?: string }>;
}) {
  const staff = await requireStaff();
  const twoStepOn = (await signInState())?.twoStepOn ?? false;
  const justTurnedOn = (await searchParams)['two-step'] === 'on';

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-semibold">Account</h1>
        <p className="text-ink-secondary">
          {staff.name}, {staffRoleLabels[staff.role]}
        </p>
        <p className="text-ink-muted">{staff.email}</p>
      </div>

      <section className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
        <h2 className="font-semibold text-ink">Two step verification</h2>
        {justTurnedOn ? <FormMessage tone="info">Two step verification is on.</FormMessage> : null}
        {twoStepOn ? (
          <>
            <p className="text-ink">
              On. Each sign in needs a code from your authenticator app
              {twoStepRequired(staff.role) ? ', as your role requires.' : '.'}
            </p>
            <p className="text-sm text-ink-muted">
              Lost your phone? Ask your Super Admin to reset two step verification.
            </p>
          </>
        ) : (
          <>
            <p className="text-ink">
              Off. Turn it on so signing in also needs a code from an authenticator app on your
              phone.
            </p>
            <Link href="/app/two-step/setup" className={primaryButtonClass}>
              Turn on two step verification
            </Link>
          </>
        )}
      </section>

      <SignOutButton />
    </main>
  );
}
