import { describe, expect, it } from 'vitest';
import { packageState, rescheduleAllowance } from './packages';

// BIL-08: a package's state from its row, and its reschedule allowance.
describe('packageState', () => {
  const held = {
    sessionsTotal: 10,
    sessionsUsed: 3,
    validUntil: '2027-01-25',
    cancelledAt: null,
  };

  it('is active through its valid until day and expired the day after', () => {
    expect(packageState(held, '2026-10-25')).toBe('active');
    expect(packageState(held, '2027-01-25')).toBe('active');
    expect(packageState(held, '2027-01-26')).toBe('expired');
  });

  it('is used up once every session is used, even before it expires', () => {
    expect(packageState({ ...held, sessionsUsed: 10 }, '2026-11-01')).toBe('used_up');
    expect(packageState({ ...held, sessionsUsed: 10 }, '2027-02-01')).toBe('used_up');
  });

  it('is cancelled once its payment is undone, whatever else', () => {
    expect(packageState({ ...held, cancelledAt: new Date() }, '2026-10-25')).toBe('cancelled');
  });
});

describe('rescheduleAllowance', () => {
  it('allows the setting per 10 sessions, rounded down', () => {
    expect(rescheduleAllowance(6, 1)).toBe(0);
    expect(rescheduleAllowance(10, 1)).toBe(1);
    expect(rescheduleAllowance(12, 1)).toBe(1);
    expect(rescheduleAllowance(20, 1)).toBe(2);
    expect(rescheduleAllowance(20, 2)).toBe(4);
  });
});
