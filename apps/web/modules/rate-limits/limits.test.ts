import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAddress } from '../../lib/network';
import { clear, count, firstLimited, limited, networkKey, take, tryAgainIn } from './limits';

const db = vi.hoisted(() => ({
  rateLimitHits: vi.fn(),
  recordRateLimitHit: vi.fn(),
  clearRateLimit: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
const settings = vi.hoisted(() => ({ getSetting: vi.fn() }));
vi.mock('../settings/settings', () => settings);

const owner = { kind: 'appDb' };
const now = new Date('2026-10-22T10:05:00Z').getTime();
const endsAt = new Date('2026-10-22T10:15:00Z');

// IAM-11: limits read their count and window from settings and count in rate_limit.
describe('rate limits', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now });
    for (const fn of Object.values(db)) fn.mockReset();
    settings.getSetting.mockReset();
    settings.getSetting.mockResolvedValue({ count: 5, minutes: 15 });
  });

  it('refuse the next attempt once the window holds the limit, with the time left', async () => {
    db.rateLimitHits.mockResolvedValueOnce({ hits: 4, endsAt });
    expect(await limited('sign_in_per_email', 'desk@clinicmx.test')).toEqual({
      limited: false,
      retryAfterSeconds: 0,
    });
    expect(settings.getSetting).toHaveBeenCalledWith('limits.sign_in_per_email');
    expect(db.rateLimitHits).toHaveBeenCalledWith(
      owner,
      'sign_in_per_email',
      'desk@clinicmx.test',
      15,
    );
    db.rateLimitHits.mockResolvedValueOnce({ hits: 5, endsAt });
    expect(await limited('sign_in_per_email', 'desk@clinicmx.test')).toEqual({
      limited: true,
      retryAfterSeconds: 600,
    });
  });

  it('count failures in the setting’s window', async () => {
    settings.getSetting.mockResolvedValue({ count: 20, minutes: 10 });
    await count('bad_links_per_network', '203.0.113.7');
    expect(db.recordRateLimitHit).toHaveBeenCalledWith(
      owner,
      'bad_links_per_network',
      '203.0.113.7',
      10,
    );
  });

  it('take counts this attempt and refuses only past the limit', async () => {
    settings.getSetting.mockResolvedValue({ count: 3, minutes: 60 });
    db.recordRateLimitHit.mockResolvedValueOnce({ hits: 3, endsAt });
    expect((await take('reset_email_per_email', 'desk@clinicmx.test')).limited).toBe(false);
    db.recordRateLimitHit.mockResolvedValueOnce({ hits: 4, endsAt });
    expect((await take('reset_email_per_email', 'desk@clinicmx.test')).limited).toBe(true);
  });

  it('clear forgets a key', async () => {
    await clear('two_step_per_person', 'staff-id');
    expect(db.clearRateLimit).toHaveBeenCalledWith(owner, 'two_step_per_person', 'staff-id');
  });

  it('report the first limit that refuses', async () => {
    const refused = { limited: true, retryAfterSeconds: 30 };
    expect(
      await firstLimited([
        Promise.resolve({ limited: false, retryAfterSeconds: 0 }),
        Promise.resolve(refused),
      ]),
    ).toEqual(refused);
    expect((await firstLimited([])).limited).toBe(false);
  });

  it('tell staff when to try again, in whole minutes', () => {
    expect(tryAgainIn({ limited: true, retryAfterSeconds: 600 })).toBe(
      'Too many attempts. Try again in 10 minutes.',
    );
    expect(tryAgainIn({ limited: true, retryAfterSeconds: 20 })).toBe(
      'Too many attempts. Try again in 1 minute.',
    );
  });
});

describe('the network', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('is the address Vercel sets, which a browser cannot change', () => {
    expect(
      requestAddress(headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' })),
    ).toBe('203.0.113.7');
  });

  it('falls back to the first forwarded address, then to one shared key', () => {
    expect(requestAddress(headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe(
      '198.51.100.1',
    );
    expect(requestAddress(headers({}))).toBeUndefined();
    expect(networkKey(undefined)).toBe('unknown');
    expect(networkKey('203.0.113.7')).toBe('203.0.113.7');
  });
});
