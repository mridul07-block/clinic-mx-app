import type { Metadata } from 'next';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password · Clinic Mx' };

// Opened from the reset email (supabase/templates/recovery.html) as
// /app/reset-password?token_hash=...; the token is only used when the form is sent.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>;
}) {
  const { token_hash: tokenHash } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
      <ResetPasswordForm tokenHash={tokenHash ?? ''} />
    </>
  );
}
