import { describe, expect, it } from 'vitest';
import { redFlagAlertStatuses } from './intake-submit';
import {
  alertEvents,
  alertOrder,
  alertTransition,
  closeAlertSchema,
  recordRedFlagSchema,
  referAlertSchema,
} from './red-flag-alerts';
import { redFlagTriageActions, redFlagTriages, triageRefers } from './red-flags';

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
    const letter = {
      reason: ' Saddle numbness with new bladder change ',
      question: 'Please assess for cauda equina.',
    };
    expect(
      referAlertSchema.parse({ alertId, referredTo: '  Emergency department ', ...letter }),
    ).toEqual({
      alertId,
      referredTo: 'Emergency department',
      reason: 'Saddle numbness with new bladder change',
      question: 'Please assess for cauda equina.',
    });
    expect(
      referAlertSchema.safeParse({ alertId, referredTo: '   ', ...letter }).error?.issues[0]
        ?.message,
    ).toBe('Say where the patient was referred.');
    // ALT-07: the letter's reason and question are needed to refer.
    expect(
      referAlertSchema
        .safeParse({ alertId, referredTo: 'ED', reason: '', question: '' })
        .error?.issues.map((i) => i.message),
    ).toEqual(['Write the reason for the referral.', 'Write the question for the specialist.']);
    expect(closeAlertSchema.safeParse({ alertId, decision: '' }).error?.issues[0]?.message).toBe(
      'Write the decision before closing.',
    );
    expect(closeAlertSchema.safeParse({ alertId, decision: 'x'.repeat(1001) }).success).toBe(false);
  });
});

// CLN-11: a red flag found in the consultation, in one of the framework's five categories.
describe('a red flag found in the consultation', () => {
  const consultationId = '0b8a3a52-31f1-4f0e-9a43-5a3f0d6b2c12';

  it('refers every category but Monitor with caution, each with the framework’s action', () => {
    expect(redFlagTriages.filter(triageRefers)).toEqual([
      'immediate_emergency',
      'urgent_medical_referral',
      'urgent_imaging',
      'specialist_referral',
    ]);
    expect(redFlagTriageActions.immediate_emergency).toBe(
      'Refer to A&E / ER immediately. Stop all physio.',
    );
  });

  it('needs where to, the reason and the question to refer; none to monitor', () => {
    const referred = recordRedFlagSchema.safeParse({
      consultationId,
      triage: 'urgent_medical_referral',
      found: 'Night pain and weight loss',
    });
    expect(referred.error?.issues.map((i) => i.path[0])).toEqual([
      'referredTo',
      'reason',
      'question',
    ]);
    expect(
      recordRedFlagSchema.parse({
        consultationId,
        triage: 'monitor_with_caution',
        found: ' Mild night pain ',
      }),
    ).toEqual({
      consultationId,
      triage: 'monitor_with_caution',
      found: 'Mild night pain',
      referredTo: '',
      reason: '',
      question: '',
    });
    expect(
      recordRedFlagSchema.safeParse({ consultationId, triage: 'monitor_with_caution', found: '' })
        .error?.issues[0]?.message,
    ).toBe('Say which red flags were found.');
  });
});
