import { describe, expect, it } from 'vitest';
import { sessionGate, sessionLabel, sessionView } from './sessions';

// SES-01: "Session n of N" and the gate a session starts behind.
describe('sessionLabel', () => {
  it('counts against the planned sessions, or alone without a frequency', () => {
    expect(sessionLabel(3, 12)).toBe('Session 3 of 12');
    expect(sessionLabel(1, null)).toBe('Session 1');
  });
});

describe('sessionView', () => {
  it('labels a checked in session and gives the gate; nothing for other appointments', () => {
    expect(sessionView({ number: 2, planned: 12, episodeStatus: 'active' })).toEqual({
      label: 'Session 2 of 12',
      gate: { met: true, message: 'Payment complete' },
    });
    expect(
      sessionView({ number: null, planned: 12, episodeStatus: 'plan_proposed' })?.label,
    ).toBeNull();
    expect(sessionView(undefined)).toBeNull();
  });
});

describe('sessionGate', () => {
  it('is met once the chosen plan is paid: Active or Under review', () => {
    expect(sessionGate('active')).toEqual({ met: true, message: 'Payment complete' });
    expect(sessionGate('under_review').met).toBe(true);
  });

  it('waits for consent and payment before the plan is paid', () => {
    for (const status of ['intake_pending', 'awaiting_consultation', 'plan_proposed'] as const) {
      expect(sessionGate(status)).toEqual({
        met: false,
        message: 'Consent and payment are needed before the first session.',
      });
    }
  });

  it('names an episode that is paused or closed, and a visit outside any episode', () => {
    expect(sessionGate('on_hold').message).toBe('The episode is On hold.');
    expect(sessionGate('discharged').message).toBe('The episode is Discharged.');
    expect(sessionGate('lost_to_follow_up').met).toBe(false);
    expect(sessionGate(null)).toEqual({ met: false, message: 'Not part of an episode yet.' });
  });
});
