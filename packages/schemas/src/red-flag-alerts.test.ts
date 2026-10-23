import { describe, expect, it } from 'vitest';
import { redFlagAlertStatuses } from './intake-submit';
import {
  alertEvents,
  alertOrder,
  alertTransition,
  closeAlertSchema,
  referAlertSchema,
} from './red-flag-alerts';

// ALT-01: raised, reviewed, referred, closed; the database trigger allows the same moves.
describe('a red flag alert', () => {
  it('moves raised to reviewed, reviewed to referred or closed, referred to closed', () => {
    const allowed = redFlagAlertStatuses.flatMap((status) =>
      alertEvents.flatMap((event) => {
        const move = alertTransition(status, event);
        return move.ok ? [`${status} ${event} ${move.next}`] : [];
      }),
    );
    expect(allowed).toEqual([
      'raised review reviewed',
      'reviewed refer referred',
      'reviewed close closed',
      'referred close closed',
    ]);
  });

  it('says why a move is refused', () => {
    expect(alertTransition('raised', 'close')).toEqual({
      ok: false,
      refusal: 'Press “I’m reviewing” before referring or closing.',
    });
    expect(alertTransition('reviewed', 'review')).toEqual({
      ok: false,
      refusal: 'Someone is already reviewing this alert.',
    });
    expect(alertTransition('referred', 'refer')).toEqual({
      ok: false,
      refusal: 'This alert has already been referred.',
    });
    expect(alertTransition('closed', 'close')).toEqual({
      ok: false,
      refusal: 'This alert is already closed.',
    });
  });

  it('lists emergencies first, then the oldest', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 23, 5, minute));
    const alerts = [
      { id: 'review-old', display: 'review' as const, raisedAt: at(1) },
      { id: 'emergency-new', display: 'emergency' as const, raisedAt: at(9) },
      { id: 'emergency-old', display: 'emergency' as const, raisedAt: at(2) },
      { id: 'information', display: 'information' as const, raisedAt: at(0) },
    ];
    expect([...alerts].sort(alertOrder).map((alert) => alert.id)).toEqual([
      'emergency-old',
      'emergency-new',
      'review-old',
      'information',
    ]);
  });

  it('needs where the patient was referred, and a written decision to close', () => {
    const alertId = '0b8a3a52-31f1-4f0e-9a43-5a3f0d6b2c11';
    expect(referAlertSchema.parse({ alertId, referredTo: '  Emergency department ' })).toEqual({
      alertId,
      referredTo: 'Emergency department',
    });
    expect(
      referAlertSchema.safeParse({ alertId, referredTo: '   ' }).error?.issues[0]?.message,
    ).toBe('Say where the patient was referred.');
    expect(closeAlertSchema.safeParse({ alertId, decision: '' }).error?.issues[0]?.message).toBe(
      'Write the decision before closing.',
    );
    expect(closeAlertSchema.safeParse({ alertId, decision: 'x'.repeat(1001) }).success).toBe(false);
  });
});
