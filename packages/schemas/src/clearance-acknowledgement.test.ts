import { describe, expect, it } from 'vitest';
import {
  clearanceSignWithTextsSchema,
  clearanceStatementKey,
  clearanceTick,
  isAcknowledgedClearance,
  parseClearanceAcknowledgement,
} from './clearance-acknowledgement';

// OUT-09 done when: the patient ticks and signs the plan, the warning signs and the residual risk.
// Recommended defaults (30 October 2026): the consultant writes the three sections when signing
// Return to training or Return to sport; the ticks' words are a placeholder (DECISION OUT-09).
describe('the clearance acknowledgement', () => {
  const episodeId = '00000000-0000-4000-8000-000000000501';
  const texts = { plan: 'Full training', warningSigns: 'Swelling', residualRisk: 'Some risk' };

  it('is asked for Return to training and Return to sport, not Rehabilitation complete', () => {
    expect(isAcknowledgedClearance('return_to_training')).toBe(true);
    expect(isAcknowledgedClearance('return_to_sport')).toBe(true);
    expect(isAcknowledgedClearance('rehabilitation_complete')).toBe(false);
    expect(clearanceStatementKey('return_to_sport', 'warning_signs')).toBe(
      'clearance.return_to_sport.warning_signs',
    );
    expect(clearanceTick).toMatchObject({ version: 1, placeholder: true });
  });

  it('needs the three sections to sign a clearance the patient acknowledges', () => {
    expect(
      clearanceSignWithTextsSchema.safeParse({ episodeId, status: 'rehabilitation_complete' })
        .success,
    ).toBe(true);
    const missing = clearanceSignWithTextsSchema.safeParse({
      episodeId,
      status: 'return_to_sport',
    });
    expect(missing.error?.issues[0]?.message).toBe(
      'Write the plan, the warning signs to stop and the residual risk for the patient.',
    );
    const blank = clearanceSignWithTextsSchema.safeParse({
      episodeId,
      status: 'return_to_training',
      texts: { ...texts, warningSigns: '   ' },
    });
    expect(blank.error?.issues[0]?.message).toBe(
      'Write the warning signs to stop for the patient.',
    );
    expect(
      clearanceSignWithTextsSchema.parse({ episodeId, status: 'return_to_sport', texts }).texts,
    ).toEqual(texts);
  });

  it('takes the patient’s acknowledgement only with every section ticked, and signed', () => {
    const ticked = { 'tick-plan': 'yes', 'tick-warning_signs': 'yes', 'tick-residual_risk': 'yes' };
    expect(parseClearanceAcknowledgement({ ...ticked, typedName: 'Test Patient' })).toEqual({
      ok: true,
      signature: { kind: 'typed', name: 'Test Patient' },
    });
    const parsed = parseClearanceAcknowledgement({ 'tick-plan': 'yes' });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : Object.keys(parsed.errors).sort()).toEqual([
      'residual_risk',
      'signature',
      'warning_signs',
    ]);
  });
});
