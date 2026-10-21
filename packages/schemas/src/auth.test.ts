import { describe, expect, it } from 'vitest';
import { signInSchema } from './auth';
import { staffInviteSchema } from './staff';

describe('emails typed in a form', () => {
  it('are trimmed and lower-cased before they are checked', () => {
    expect(signInSchema.parse({ email: ' Desk.HSR@ClinicMx.test ', password: 'x' }).email).toBe(
      'desk.hsr@clinicmx.test',
    );
    expect(
      staffInviteSchema.parse({
        email: ' New.Desk@ClinicMx.test',
        details: {
          name: 'Test Desk',
          role: 'finance',
          treatsPatients: false,
          consultant: false,
          centreIds: [],
        },
      }).email,
    ).toBe('new.desk@clinicmx.test');
  });

  it('are refused when they are not an email address', () => {
    expect(signInSchema.safeParse({ email: 'desk', password: 'x' }).error?.issues[0]?.message).toBe(
      'Enter your email address.',
    );
  });
});
