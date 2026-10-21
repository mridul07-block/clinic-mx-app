import type { Metadata } from 'next';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Reset password · Clinic Mx' };

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
        <p className="text-ink-secondary">We will email you a link to choose a new password.</p>
      </div>
      <ForgotPasswordForm />
    </>
  );
}
