import { staffRoles } from '@clinic-mx/schemas';
import { describe, expect, it } from 'vitest';
import { signInStage } from './two-step';

// IAM-02 done when: two step verification is required for all roles except Front Desk.
describe('signInStage', () => {
  it('requires an authenticator app for every role except Front Desk', () => {
    const stages = Object.fromEntries(
      staffRoles.map((role) => [
        role,
        signInStage({ role, level: 'aal1', hasAuthenticator: false }),
      ]),
    );
    expect(stages).toEqual({
      super_admin: 'setup',
      centre_manager: 'setup',
      front_desk: 'complete',
      physiotherapist: 'setup',
      finance: 'setup',
    });
  });

  it('asks anyone with an authenticator app for a code, Front Desk included', () => {
    for (const role of staffRoles) {
      expect(signInStage({ role, level: 'aal1', hasAuthenticator: true })).toBe('verify');
    }
  });

  it('is complete once a code was entered', () => {
    for (const role of staffRoles) {
      expect(signInStage({ role, level: 'aal2', hasAuthenticator: true })).toBe('complete');
    }
  });

  it('treats a session with no level as not verified', () => {
    expect(signInStage({ role: 'finance', level: undefined, hasAuthenticator: false })).toBe(
      'setup',
    );
  });
});
