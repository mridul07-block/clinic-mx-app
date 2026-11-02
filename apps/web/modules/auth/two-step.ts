import { twoStepRequired, type StaffRole } from '@clinic-mx/schemas';
import { serverEnv } from '../../lib/env';

/** The reserved address of the seed's test logins, which production never has. */
const TEST_LOGIN_DOMAIN = '@clinicmx.test';

/**
 * Staging only, for showing the app to clients: test logins need no code while
 * STAGING_SKIP_TWO_STEP_FOR_TEST_LOGINS is on (docs/runbooks/auth.md). A real person's address is
 * never let through, with the switch on or off.
 */
function skipsTwoStep(email: string): boolean {
  return (
    serverEnv().STAGING_SKIP_TWO_STEP_FOR_TEST_LOGINS === 'on' &&
    email.toLowerCase().endsWith(TEST_LOGIN_DOMAIN)
  );
}

/**
 * How far a staff member's sign in has got (IAM-02): `complete`, or waiting for a code from their
 * authenticator app (`verify`), or for them to add one because their role requires it (`setup`).
 * Front Desk staff who turned two step verification on are asked for a code like everyone else.
 */
export type SignInStage = 'complete' | 'verify' | 'setup';

export function signInStage({
  role,
  email,
  level,
  hasAuthenticator,
}: {
  role: StaffRole;
  /** The staff row's address, never what was typed. */
  email: string;
  /** The session's assurance level from its signed token: aal2 once a code was entered. */
  level: string | undefined;
  /** A verified authenticator app, as Supabase Auth reports it (never from the cookie). */
  hasAuthenticator: boolean;
}): SignInStage {
  if (level === 'aal2' || skipsTwoStep(email)) return 'complete';
  if (hasAuthenticator) return 'verify';
  return twoStepRequired(role) ? 'setup' : 'complete';
}

/** Where each stage that is not complete continues. */
export const stagePath = { verify: '/app/two-step', setup: '/app/two-step/setup' } as const;
