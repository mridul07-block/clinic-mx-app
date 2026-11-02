import { staffRoles } from '@clinic-mx/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signInStage } from './two-step';

const email = 'person@clinic.example';

afterEach(() => {
  vi.unstubAllEnvs();
});

// IAM-02 done when: two step verification is required for all roles except Front Desk.
describe('signInStage', () => {
  it('requires an authenticator app for every role except Front Desk', () => {
    const stages = Object.fromEntries(
      staffRoles.map((role) => [
        role,
        signInStage({ role, email, level: 'aal1', hasAuthenticator: false }),
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
      expect(signInStage({ role, email, level: 'aal1', hasAuthenticator: true })).toBe('verify');
    }
  });

  it('is complete once a code was entered', () => {
    for (const role of staffRoles) {
      expect(signInStage({ role, email, level: 'aal2', hasAuthenticator: true })).toBe('complete');
    }
  });

  it('treats a session with no level as not verified', () => {
    expect(signInStage({ role: 'finance', email, level: undefined, hasAuthenticator: false })).toBe(
      'setup',
    );
  });
});

// Staging only, for showing the app to clients: never a real person, never without the switch.
describe('signInStage with test logins skipping two step verification', () => {
  const testLogin = 'finance@clinicmx.test';
  const stage = (address: string, hasAuthenticator = false) =>
    signInStage({ role: 'finance', email: address, level: 'aal1', hasAuthenticator });

  it('still asks test logins when the switch is off', () => {
    expect(stage(testLogin)).toBe('setup');
    expect(stage(testLogin, true)).toBe('verify');
  });

  it('counts an emptied switch as off', () => {
    vi.stubEnv('STAGING_SKIP_TWO_STEP_FOR_TEST_LOGINS', '');
    expect(stage(testLogin)).toBe('setup');
  });

  it('lets test logins of every role through when it is on', () => {
    vi.stubEnv('STAGING_SKIP_TWO_STEP_FOR_TEST_LOGINS', 'on');
    for (const role of staffRoles) {
      expect(signInStage({ role, email: testLogin, level: 'aal1', hasAuthenticator: false })).toBe(
        'complete',
      );
    }
  });

  it('skips the code too for a test login that added an authenticator app', () => {
    vi.stubEnv('STAGING_SKIP_TWO_STEP_FOR_TEST_LOGINS', 'on');
    expect(stage(testLogin, true)).toBe('complete');
  });

  it('matches the address whatever its case', () => {
    vi.stubEnv('STAGING_SKIP_TWO_STEP_FOR_TEST_LOGINS', 'on');
    expect(stage('Finance@ClinicMx.Test')).toBe('complete');
  });

  it('still asks everyone else when it is on', () => {
    vi.stubEnv('STAGING_SKIP_TWO_STEP_FOR_TEST_LOGINS', 'on');
    for (const address of [
      email,
      'finance@clinicmx.test.example.com',
      'finance@notclinicmx.test',
      'clinicmx.test@clinic.example',
    ]) {
      expect(stage(address)).toBe('setup');
      expect(stage(address, true)).toBe('verify');
    }
  });

  it('refuses any other value for the switch', () => {
    vi.stubEnv('STAGING_SKIP_TWO_STEP_FOR_TEST_LOGINS', 'true');
    expect(() => stage(testLogin)).toThrow();
  });
});
