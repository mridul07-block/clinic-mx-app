import { describe, expect, it } from 'vitest';
import {
  applyDiscountSchema,
  billKindLabels,
  percentOff,
  removeDiscountSchema,
  unpaidSessionsLabel,
  ytpFlagged,
} from './bills';

const lineId = '00000000-0000-4000-8000-000000000d01';
const presetId = '00000000-0000-4000-8000-000000000d02';

// BIL-07: a preset from the list, or an Other discount of a whole percent or an amount with its
// reason; a percent off is rounded half up to the paisa, as the database checks.
describe('discounts', () => {
  it('rounds a percent off half up to the paisa', () => {
    expect(percentOff(75000, 10)).toBe(7500);
    expect(percentOff(75050, 12)).toBe(9006);
    expect(percentOff(5, 10)).toBe(1);
    expect(percentOff(4, 10)).toBe(0);
    expect(percentOff(900000, 100)).toBe(900000);
  });

  it('reads a preset, a percent or an amount with its reason', () => {
    expect(applyDiscountSchema.parse({ kind: 'preset', lineId, presetId })).toEqual({
      kind: 'preset',
      lineId,
      presetId,
    });
    expect(
      applyDiscountSchema.parse({ kind: 'percent', lineId, percent: ' 15 ', reason: ' Hardship ' }),
    ).toEqual({ kind: 'percent', lineId, percent: 15, reason: 'Hardship' });
    expect(
      applyDiscountSchema.parse({ kind: 'flat', lineId, amount: '₹1,250.50', reason: 'Goodwill' }),
    ).toEqual({ kind: 'flat', lineId, amount: 125050, reason: 'Goodwill' });
  });

  it('refuses an Other discount without a reason, a percent outside 1 to 99, and no choice', () => {
    const message = (input: unknown) =>
      applyDiscountSchema.safeParse(input).error?.issues[0]?.message;
    expect(message({ kind: 'percent', lineId, percent: '15', reason: '  ' })).toBe(
      'Say why this discount is given.',
    );
    for (const percent of ['0', '100', '12.5', 'ten']) {
      expect(message({ kind: 'percent', lineId, percent, reason: 'Hardship' })).toBe(
        'Enter a whole percent from 1 to 99.',
      );
    }
    expect(message({ kind: 'flat', lineId, amount: '0', reason: 'Goodwill' })).toBe(
      'Enter an amount above ₹0.',
    );
    expect(message({ kind: 'preset', lineId })).toBe('Choose a discount.');
    expect(message({ lineId })).toBe('Choose a discount.');
    expect(removeDiscountSchema.safeParse({ lineId: 'x' }).success).toBe(false);
  });
});

// BIL-10: pay as you go balances, flagged above the set number of unpaid sessions (PRD section 7).
describe('pay as you go balances', () => {
  it('flags only more than the setting’s unpaid sessions, whatever the setting', () => {
    expect(ytpFlagged(3, 3)).toBe(false);
    expect(ytpFlagged(4, 3)).toBe(true);
    expect(ytpFlagged(0, 0)).toBe(false);
    expect(ytpFlagged(1, 0)).toBe(true);
    expect(ytpFlagged(5, 5)).toBe(false);
  });

  it('names the unpaid sessions and the session bill', () => {
    expect(unpaidSessionsLabel(1)).toBe('1 unpaid session');
    expect(unpaidSessionsLabel(4)).toBe('4 unpaid sessions');
    expect(billKindLabels.session).toBe('Session');
  });
});
