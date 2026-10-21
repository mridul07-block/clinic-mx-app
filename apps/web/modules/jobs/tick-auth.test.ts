import { describe, expect, it } from 'vitest';
import { isAuthorisedTick } from './tick-auth';

describe('isAuthorisedTick', () => {
  const secret = 'a-long-random-secret';

  it('accepts the right bearer secret', () => {
    expect(isAuthorisedTick(`Bearer ${secret}`, secret)).toBe(true);
  });

  it.each([
    ['no header', null],
    ['a wrong secret', 'Bearer wrong'],
    ['a secret that is a prefix', 'Bearer a-long'],
    ['no Bearer prefix', secret],
    ['an empty bearer', 'Bearer '],
  ])('refuses %s', (_case, header) => {
    expect(isAuthorisedTick(header, secret)).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    expect(isAuthorisedTick('Bearer ', undefined)).toBe(false);
    expect(isAuthorisedTick('Bearer anything', '')).toBe(false);
  });
});
