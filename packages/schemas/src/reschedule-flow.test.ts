import { describe, expect, it } from 'vitest';
import { rescheduleRefusalMessages, selfRescheduleCheck } from './reschedule-flow';

// WA-05 done when: reschedules left shown; Zero Gravity Treadmill blocked. Both limits show as
// they apply (user decision, 31 October 2026).
const base = {
  typeKey: 'session',
  neverReschedulable: ['zero_gravity_treadmill'],
  packageSession: null,
  counts: { reschedules: 0, noShows: 0 },
  limits: { reschedules: 2, noShows: 2 },
};

describe('whether the patient may move an appointment on WhatsApp', () => {
  it('shows the online reschedules left for any appointment', () => {
    expect(selfRescheduleCheck(base)).toEqual({
      refusal: null,
      lines: ['You can move appointments online 2 more times.'],
    });
    expect(selfRescheduleCheck({ ...base, counts: { reschedules: 1, noShows: 1 } }).lines).toEqual([
      'You can move appointments online 1 more time.',
    ]);
  });

  it('shows a package session’s reschedules left as well', () => {
    expect(selfRescheduleCheck({ ...base, packageSession: { reschedulesLeft: 1 } })).toEqual({
      refusal: null,
      lines: [
        'This package has 1 reschedule left; moving uses one.',
        'You can move appointments online 2 more times.',
      ],
    });
  });

  it('never moves a Zero Gravity Treadmill session, with or without a package', () => {
    const treadmill = { ...base, typeKey: 'zero_gravity_treadmill' };
    expect(selfRescheduleCheck(treadmill).refusal).toBe('treadmill');
    expect(
      selfRescheduleCheck({ ...treadmill, packageSession: { reschedulesLeft: 3 } }).refusal,
    ).toBe('treadmill');
    expect(rescheduleRefusalMessages.treadmill).toBe(
      'Zero Gravity Treadmill sessions cannot be moved online.',
    );
  });

  it('refuses once self booking is blocked, by reschedules or no shows', () => {
    expect(selfRescheduleCheck({ ...base, counts: { reschedules: 2, noShows: 0 } }).refusal).toBe(
      'self_booking',
    );
    expect(selfRescheduleCheck({ ...base, counts: { reschedules: 0, noShows: 2 } }).refusal).toBe(
      'self_booking',
    );
  });

  it('refuses a package session with no reschedules left', () => {
    expect(selfRescheduleCheck({ ...base, packageSession: { reschedulesLeft: 0 } }).refusal).toBe(
      'package_used',
    );
  });
});
