import { describe, expect, it } from 'vitest';
import {
  allowedStatusPairs,
  dischargeReasons,
  episodeEvents,
  episodeStatuses,
  episodeTransition,
  type EpisodeEvent,
  type EpisodeState,
  type EpisodeStatus,
} from './episodes';

// SCH-03 done when: all statuses from the PRD with guarded transitions and audit. The expected
// moves are written out here by hand, from the plan's table, not computed from the machine.
const expected: Record<EpisodeEvent, Partial<Record<EpisodeStatus, EpisodeStatus>>> = {
  submit_intake: { intake_pending: 'awaiting_consultation' },
  propose_plan: { awaiting_consultation: 'plan_proposed' },
  activate: { plan_proposed: 'active' },
  start_review: { active: 'under_review' },
  continue: { under_review: 'active' },
  hold: {
    intake_pending: 'on_hold',
    awaiting_consultation: 'on_hold',
    plan_proposed: 'on_hold',
    active: 'on_hold',
    under_review: 'on_hold',
  },
  resume: { on_hold: 'active' },
  mark_lost: {
    intake_pending: 'lost_to_follow_up',
    awaiting_consultation: 'lost_to_follow_up',
    plan_proposed: 'lost_to_follow_up',
    active: 'lost_to_follow_up',
    under_review: 'lost_to_follow_up',
    on_hold: 'lost_to_follow_up',
  },
  return: { lost_to_follow_up: 'active' },
  discharge: {
    intake_pending: 'discharged',
    awaiting_consultation: 'discharged',
    plan_proposed: 'discharged',
    active: 'discharged',
    under_review: 'discharged',
    on_hold: 'discharged',
    lost_to_follow_up: 'discharged',
  },
};

/** A state in `status`; a paused one remembers Active. */
const at = (status: EpisodeStatus): EpisodeState => ({
  status,
  pausedFrom: status === 'on_hold' || status === 'lost_to_follow_up' ? 'active' : null,
});

describe('episode status machine', () => {
  it('allows exactly the moves in the table, from every status, for every event', () => {
    for (const event of episodeEvents) {
      for (const status of episodeStatuses) {
        const result = episodeTransition(at(status), event, { reason: 'patient_choice' });
        const want = expected[event][status];
        expect(result.ok ? result.next.status : null, `${event} from ${status}`).toBe(want ?? null);
      }
    }
  });

  it('keeps the status a hold or a loss paused, and goes back to it', () => {
    const held = episodeTransition(at('plan_proposed'), 'hold');
    expect(held).toEqual({ ok: true, next: { status: 'on_hold', pausedFrom: 'plan_proposed' } });
    if (!held.ok) return;
    // Lost while on hold: the status before the hold is kept.
    const lost = episodeTransition(held.next, 'mark_lost');
    expect(lost).toEqual({
      ok: true,
      next: { status: 'lost_to_follow_up', pausedFrom: 'plan_proposed' },
    });
    if (!lost.ok) return;
    expect(episodeTransition(lost.next, 'return')).toEqual({
      ok: true,
      next: { status: 'plan_proposed', pausedFrom: null },
    });
    expect(episodeTransition({ status: 'on_hold', pausedFrom: null }, 'resume').ok).toBe(false);
  });

  it('never counts non attendance as recovered (PRD J6.6)', () => {
    for (const status of [
      'intake_pending',
      'awaiting_consultation',
      'plan_proposed',
      'lost_to_follow_up',
    ] as const) {
      for (const reason of ['goals_achieved', 'independent_management'] as const) {
        const result = episodeTransition(at(status), 'discharge', { reason });
        expect(result.ok, `${reason} from ${status}`).toBe(false);
      }
    }
    expect(episodeTransition(at('active'), 'discharge', { reason: 'goals_achieved' }).ok).toBe(
      true,
    );
    expect(
      episodeTransition(at('under_review'), 'discharge', { reason: 'independent_management' }).ok,
    ).toBe(true);
    // On hold from Active: treated, so recovered is allowed.
    expect(
      episodeTransition({ status: 'on_hold', pausedFrom: 'active' }, 'discharge', {
        reason: 'goals_achieved',
      }).ok,
    ).toBe(true);
    // Lost to follow up is refused even if it was Active before.
    const lost = episodeTransition(at('lost_to_follow_up'), 'discharge', {
      reason: 'goals_achieved',
    });
    expect(lost.ok ? '' : lost.refusal).toContain('Non attendance is never counted as recovered');
  });

  it('needs a reason, and a note for Other', () => {
    expect(episodeTransition(at('active'), 'discharge').ok).toBe(false);
    expect(episodeTransition(at('active'), 'discharge', { reason: 'other', note: ' ' }).ok).toBe(
      false,
    );
    expect(
      episodeTransition(at('active'), 'discharge', { reason: 'other', note: 'Moved city' }).ok,
    ).toBe(true);
    expect(dischargeReasons).toHaveLength(7);
  });

  it('keeps a discharged episode closed', () => {
    for (const event of episodeEvents) {
      const result = episodeTransition(at('discharged'), event, { reason: 'patient_choice' });
      expect(result.ok ? '' : result.refusal).toContain('opens a new episode');
    }
  });

  it('lists the status pairs the database trigger allows', () => {
    const pairs = allowedStatusPairs().map(([from, to]) => `${from}>${to}`);
    expect(pairs).toContain('on_hold>plan_proposed');
    expect(pairs).toContain('lost_to_follow_up>intake_pending');
    expect(pairs).not.toContain('intake_pending>active');
    expect(pairs.some((pair) => pair.startsWith('discharged>'))).toBe(false);
  });
});
