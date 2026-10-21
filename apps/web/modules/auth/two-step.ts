import { twoStepRequired, type StaffRole } from '@clinic-mx/schemas';

/**
 * How far a staff member's sign in has got (IAM-02): `complete`, or waiting for a code from their
 * authenticator app (`verify`), or for them to add one because their role requires it (`setup`).
 * Front Desk staff who turned two step verification on are asked for a code like everyone else.
 */
export type SignInStage = 'complete' | 'verify' | 'setup';

export function signInStage({
  role,
  level,
  hasAuthenticator,
}: {
  role: StaffRole;
  /** The session's assurance level from its signed token: aal2 once a code was entered. */
  level: string | undefined;
  /** A verified authenticator app, as Supabase Auth reports it (never from the cookie). */
  hasAuthenticator: boolean;
}): SignInStage {
  if (level === 'aal2') return 'complete';
  if (hasAuthenticator) return 'verify';
  return twoStepRequired(role) ? 'setup' : 'complete';
}

/** Where each stage that is not complete continues. */
export const stagePath = { verify: '/app/two-step', setup: '/app/two-step/setup' } as const;
