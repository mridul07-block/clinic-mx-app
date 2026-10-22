import { describe, expect, it } from 'vitest';
import { MAX_PAISE, formatRupees, rupeesSchema, rupeesText } from './money';

// Rule 15: money in integer paise; shown in rupees with Indian grouping.
describe('money', () => {
  it('reads rupees however they are typed, as paise', () => {
    for (const [typed, paise] of [
      ['1500', 150000],
      ['1,500', 150000],
      ['₹1,500', 150000],
      ['₹ 1500.5', 150050],
      ['  1500.50 ', 150050],
      ['18,40,000', 184000000],
      ['0.01', 1],
    ] as const) {
      expect(rupeesSchema.parse(typed), typed).toBe(paise);
    }
  });

  it('refuses what is not a positive amount of rupees and paise', () => {
    for (const typed of ['', '0', '0.00', '-100', '1500.505', '1.5.0', 'abc', '15OO', '$100']) {
      expect(rupeesSchema.safeParse(typed).success, typed).toBe(false);
    }
    expect(rupeesSchema.safeParse(String(MAX_PAISE / 100 + 1)).success).toBe(false);
  });

  it('shows paise as rupees with Indian grouping', () => {
    expect(formatRupees(75000)).toBe('₹750');
    expect(formatRupees(150000)).toBe('₹1,500');
    expect(formatRupees(150050)).toBe('₹1,500.50');
    expect(formatRupees(184000000)).toBe('₹18,40,000');
    expect(formatRupees(5)).toBe('₹0.05');
    expect(formatRupees(-20000)).toBe('-₹200');
    expect(rupeesText(150050)).toBe('1,500.50');
  });

  it('gives back what it shows', () => {
    for (const paise of [1, 99, 100, 75000, 150050, 184000000, MAX_PAISE]) {
      expect(rupeesSchema.parse(rupeesText(paise))).toBe(paise);
    }
  });
});
