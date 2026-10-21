import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNextPath } from '../../../../../modules/auth/next-path';
import { currentStaff } from '../../../../../modules/auth/session';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in · Clinic Mx' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; password?: string }>;
}) {
  const { next, password } = await searchParams;
  if (await currentStaff()) redirect(safeNextPath(next));
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Sign in</h1>
      <SignInForm next={safeNextPath(next)} passwordChanged={password === 'changed'} />
    </>
  );
}
