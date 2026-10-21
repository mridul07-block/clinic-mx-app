import type { Metadata } from 'next';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Choose a password · Clinic Mx' };

// Opened from the reset email (supabase/templates/recovery.html) as
// /app/reset-password?token_hash=..., or from an invite (supabase/templates/invite.html, IAM-06)
// with &type=invite; the token is only used when the form is sent.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;
  const invite = type === 'invite';
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">
        {invite ? 'Set your password' : 'Choose a new password'}
      </h1>
      <ResetPasswordForm tokenHash={tokenHash ?? ''} invite={invite} />
    </>
  );
}
