import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { nextParam } from '../../../../../modules/auth/auth-support';
import { homePath, safeNextPath } from '../../../../../modules/auth/next-path';
import { signInState } from '../../../../../modules/auth/session';
import { SignOutLink } from '../sign-out-link';
import { TwoStepForm } from './two-step-form';

export const metadata: Metadata = { title: 'Two step verification · Clinic Mx' };

// IAM-02: after the password, a code from the authenticator app.
export default async function TwoStepPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const asked = (await searchParams).next;
  const next = safeNextPath(asked);
  const state = await signInState();
  if (!state) redirect('/app/sign-in');
  // Already through: where they asked to go, or their role's landing screen.
  if (state.stage === 'complete') redirect(safeNextPath(asked, homePath(state.staff.role)));
  if (state.stage === 'setup') redirect(`/app/two-step/setup${nextParam(next)}`);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Enter your code</h1>
        <p className="text-ink-secondary">
          Open your authenticator app and enter the 6 digit code for Clinic Mx.
        </p>
      </div>
      <TwoStepForm next={next} />
      <p className="text-sm text-ink-muted">
        Lost your phone? Ask your Super Admin to reset two step verification.
      </p>
      <SignOutLink />
    </>
  );
}
