import { sessionEndReasons } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { homePath, safeNextPath } from '../../../../../modules/auth/next-path';
import { currentStaff } from '../../../../../modules/auth/session';
import { getSetting } from '../../../../../modules/settings/settings';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in · Clinic Mx' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; password?: string; reason?: string }>;
}) {
  const { next, password, reason } = await searchParams;
  const ended = sessionEndReasons.find((known) => known === reason);
  const signedIn = await currentStaff();
  if (signedIn) redirect(safeNextPath(next, homePath(signedIn.role)));
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Sign in</h1>
      <SignInForm
        next={safeNextPath(next)}
        passwordChanged={password === 'changed'}
        ended={ended}
        idleMinutes={
          ended === 'idle' ? await getSetting('security.desktop_idle_logout_minutes') : 0
        }
      />
    </>
  );
}
