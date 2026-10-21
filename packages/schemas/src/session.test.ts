import { describe, expect, it } from 'vitest';
import { deviceClass, passwordSignInTime, sessionVerdict, type SessionFacts } from './session';

const now = new Date('2026-10-22T10:00:00Z');
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const facts = (values: Partial<SessionFacts>): SessionFacts => ({
  device: 'desktop',
  now,
  idleMinutes: 15,
  phoneDays: 30,
  ...values,
});

// IAM-07: 15 minute idle logout on desktop; phone sessions persist (30 days, G7).
describe('sessionVerdict', () => {
  it('ends a desktop session after the idle minutes, not before', () => {
    expect(sessionVerdict(facts({ lastSeen: minutesAgo(14) }))).toBe('ok');
    expect(sessionVerdict(facts({ lastSeen: minutesAgo(15) }))).toBe('ok');
    expect(sessionVerdict(facts({ lastSeen: minutesAgo(16) }))).toBe('idle');
  });

  it('reads the idle minutes from the setting', () => {
    expect(sessionVerdict(facts({ lastSeen: minutesAgo(6), idleMinutes: 5 }))).toBe('idle');
    expect(sessionVerdict(facts({ lastSeen: minutesAgo(16), idleMinutes: 30 }))).toBe('ok');
  });

  it('lets a desktop session with no activity known yet go on', () => {
    expect(sessionVerdict(facts({}))).toBe('ok');
  });

  it('keeps a phone session however long it was idle, until the phone days pass', () => {
    const phone = { device: 'phone' as const, lastSeen: daysAgo(3) };
    expect(sessionVerdict(facts({ ...phone, signedInAt: daysAgo(29) }))).toBe('ok');
    expect(sessionVerdict(facts({ ...phone, signedInAt: daysAgo(31) }))).toBe('expired');
    expect(sessionVerdict(facts({ ...phone, signedInAt: daysAgo(8), phoneDays: 7 }))).toBe(
      'expired',
    );
  });
});

describe('deviceClass', () => {
  it('counts anything but a phone as a desktop, the stricter rule', () => {
    expect(deviceClass('phone')).toBe('phone');
    expect(deviceClass('desktop')).toBe('desktop');
    expect(deviceClass(undefined)).toBe('desktop');
    expect(deviceClass('tablet')).toBe('desktop');
  });
});

describe('passwordSignInTime', () => {
  it('takes the password entry of the token, not a later two step code', () => {
    const amr = [
      { method: 'totp', timestamp: 1792700100 },
      { method: 'password', timestamp: 1792700000 },
    ];
    expect(passwordSignInTime(amr)?.toISOString()).toBe(new Date(1792700000 * 1000).toISOString());
  });

  it('falls back to the first entry, and knows nothing from anything else', () => {
    expect(passwordSignInTime([{ method: 'otp', timestamp: 1792700000 }])).toEqual(
      new Date(1792700000 * 1000),
    );
    expect(passwordSignInTime(undefined)).toBeUndefined();
    expect(passwordSignInTime(['password'])).toBeUndefined();
  });
});
