import { describe, expect, it } from 'vitest';
import { endSupportSchema, grantEndsAt, grantSupportSchema, supportLoginSchema } from './support';

// IAM-08: a grant is for whole hours, from 1 up to the setting, and always has a reason.
describe('grantSupportSchema', () => {
  const schema = grantSupportSchema(24);
  const hours = (value: unknown) => schema.safeParse({ hours: value, reason: 'Report bug 12' });

  it('takes 1 to the longest grant, typed as text in a form', () => {
    expect(hours('1').data).toEqual({ hours: 1, reason: 'Report bug 12' });
    expect(hours(24).data?.hours).toBe(24);
  });

  it('refuses 0, more than the setting, part hours and nothing', () => {
    for (const value of [0, '0', 25, '25', 1.5, '', 'two']) {
      const result = hours(value);
      expect(result.success, String(value)).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('Choose from 1 to 24 hours.');
    }
  });

  it('follows the setting', () => {
    expect(grantSupportSchema(8).safeParse({ hours: 9, reason: 'x' }).success).toBe(false);
    expect(grantSupportSchema(72).safeParse({ hours: 48, reason: 'x' }).success).toBe(true);
  });

  it('needs a reason', () => {
    const result = schema.safeParse({ hours: 2, reason: '   ' });
    expect(result.error?.issues[0]?.message).toBe('Say what Velyx support needs the access for.');
  });
});

describe('the other support inputs', () => {
  it('end a grant by its id', () => {
    expect(endSupportSchema.safeParse({ grantId: 'not-an-id' }).success).toBe(false);
  });

  it('add a support login with a trimmed, lower case email and a name', () => {
    expect(
      supportLoginSchema.parse({ email: ' Help@Velyx.test ', name: ' Velyx support ' }),
    ).toEqual({ email: 'help@velyx.test', name: 'Velyx support' });
    expect(supportLoginSchema.safeParse({ email: 'x', name: 'A' }).success).toBe(false);
  });

  it('end a grant the given hours from now', () => {
    expect(grantEndsAt(2, new Date('2026-10-22T09:00:00Z'))).toEqual(
      new Date('2026-10-22T11:00:00Z'),
    );
  });
});
