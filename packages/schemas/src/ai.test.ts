import { describe, expect, it } from 'vitest';
import {
  aiSheetGateState,
  aiSheetSettingSchema,
  aiSheetSwitchChoices,
  aiSheetSwitchSchema,
} from './ai';
import { addDays, istDate } from './ist';

// AI-09 done when: the AI sheet is switched on only after the blind test passes and the legal
// check clears. Here: what the Super Admin records to switch it on, and when it counts as on.
const today = istDate(new Date());
const record = (date = '2026-10-20') => ({ date, reference: 'Blind test report v1' });
const kb = { id: '00000000-0000-4000-8000-000000000c01', number: 3 };
const stored = {
  on: true,
  blindTest: record(),
  legalCheck: { date: '2026-10-21', reference: 'Opinion 12/2026' },
  since: '2026-10-28T06:00:00.000Z',
  kbVersionId: kb.id,
  kbVersionNumber: kb.number,
};

describe('the AI preparation sheet switch', () => {
  it('switches off any time, and on only with both records', () => {
    expect(aiSheetSwitchSchema.parse({ on: false })).toEqual({ on: false });
    expect(
      aiSheetSwitchSchema.parse({
        on: true,
        blindTest: { date: today, reference: '  Blind test report v1 ' },
        legalCheck: record(),
      }),
    ).toEqual({
      on: true,
      blindTest: { date: today, reference: 'Blind test report v1' },
      legalCheck: record(),
    });
    expect(aiSheetSwitchSchema.safeParse({ on: true, blindTest: record() }).success).toBe(false);
    expect(
      aiSheetSwitchSchema.safeParse({
        on: true,
        blindTest: record(),
        legalCheck: { date: '2026-10-21', reference: '   ' },
      }).success,
    ).toBe(false);
    expect(
      aiSheetSwitchSchema.safeParse({
        on: true,
        blindTest: record('2026-02-30'),
        legalCheck: record(),
      }).success,
    ).toBe(false);
    expect(
      aiSheetSwitchSchema.safeParse({ on: true, blindTest: record(), legalCheck: record(), x: 1 })
        .success,
    ).toBe(false);
  });

  it('refuses a date in the future', () => {
    const result = aiSheetSwitchSchema.safeParse({
      on: true,
      blindTest: record(),
      legalCheck: record(addDays(today, 1)),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('The legal check date cannot be in the future.');
  });

  it('stores off, or on with the records and the knowledge base version', () => {
    expect(aiSheetSettingSchema.parse({ on: false })).toEqual({ on: false });
    expect(aiSheetSettingSchema.parse(stored)).toEqual(stored);
    expect(aiSheetSettingSchema.safeParse({ on: true }).success).toBe(false);
  });
});

describe('the AI gate', () => {
  it('is on only while switched on for the live knowledge base version', () => {
    expect(aiSheetGateState(stored, kb)).toEqual({
      on: true,
      kbVersionId: kb.id,
      kbVersionNumber: kb.number,
    });
    expect(aiSheetGateState({ on: false }, kb)).toEqual({ on: false, reason: 'off' });
    expect(
      aiSheetGateState(stored, { id: '00000000-0000-4000-8000-000000000c02', number: 4 }),
    ).toEqual({ on: false, reason: 'knowledge_base_changed', switchedOnFor: 3 });
    expect(aiSheetGateState(stored, undefined)).toEqual({ on: false, reason: 'no_knowledge_base' });
  });

  it('can be switched off while a knowledge base change holds it off, not only while on', () => {
    const newer = { id: '00000000-0000-4000-8000-000000000c02', number: 4 };
    expect(aiSheetSwitchChoices(stored, aiSheetGateState(stored, kb))).toEqual({
      switchOff: true,
      switchOn: false,
    });
    expect(aiSheetSwitchChoices(stored, aiSheetGateState(stored, newer))).toEqual({
      switchOff: true,
      switchOn: true,
    });
    expect(aiSheetSwitchChoices({ on: false }, aiSheetGateState({ on: false }, kb))).toEqual({
      switchOff: false,
      switchOn: true,
    });
  });

  it('fails closed on anything it cannot read', () => {
    for (const value of [undefined, null, true, { on: true }, { on: 'yes' }, 'on']) {
      expect(aiSheetGateState(value, kb)).toEqual({ on: false, reason: 'unreadable' });
    }
  });
});
