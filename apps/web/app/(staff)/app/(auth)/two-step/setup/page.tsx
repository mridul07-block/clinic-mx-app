import { twoStepRequired } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNextPath } from '../../../../../../modules/auth/next-path';
import { signInState } from '../../../../../../modules/auth/session';
import { supabaseServer } from '../../../../../../lib/supabase/server';
import { FormMessage } from '../../../../../../components/forms';
import { SignOutLink } from '../../sign-out-link';
import { SetupForm } from './setup-form';

export const metadata: Metadata = { title: 'Set up two step verification · Clinic Mx' };

// IAM-02: adding an authenticator app. Required roles come here from sign in; Front Desk from the
// account page. Each visit starts a fresh setup and removes any left unfinished.
export const dynamic = 'force-dynamic';

export default async function TwoStepSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const state = await signInState();
  if (!state) redirect('/app/sign-in');
  if (state.twoStepOn) redirect(state.stage === 'verify' ? '/app/two-step' : '/app/account');

  const supabase = await supabaseServer();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'Clinic Mx',
    friendlyName: 'Authenticator app',
  });

  const required = twoStepRequired(state.staff.role);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Set up two step verification</h1>
        <p className="text-ink-secondary">
          {required
            ? 'Your role needs a code from an authenticator app each time you sign in, as well as your password.'
            : 'Each time you sign in you will also enter a code from an authenticator app.'}
        </p>
      </div>
      {error ? (
        <FormMessage tone="danger">
          Two step verification cannot be set up right now. Try again in a few minutes.
        </FormMessage>
      ) : (
        <SetupForm
          factorId={data.id}
          qrCode={data.totp.qr_code}
          secret={data.totp.secret}
          uri={data.totp.uri}
          next={next}
        />
      )}
      {required ? <SignOutLink /> : null}
    </>
  );
}
