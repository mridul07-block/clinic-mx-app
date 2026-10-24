import { describe, expect, it } from 'vitest';
import {
  documentFileName,
  documentKindAccess,
  documentKinds,
  documentReadAtAnyCentre,
  documentSeries,
  letterheadLines,
} from './documents';
import { documentDate, documentDateTime, documentTime } from './ist';
import { indianNumber } from './money';
import { permissionMap } from './permissions';

// ALT-05: the PDF framework's words and numbers, as documents print them.
describe('documents', () => {
  it('names each version of a document', () => {
    expect(documentFileName('consultation_summary', 1)).toBe('consultation-summary-v1.pdf');
    expect(documentFileName('invoice_receipt', 12)).toBe('invoice-receipt-v12.pdf');
  });

  it('opens clinical documents with clinical.read at any centre, the invoice with its amounts', () => {
    for (const kind of documentKinds) {
      expect(permissionMap[documentKindAccess[kind]], kind).toBeDefined();
    }
    expect(documentReadAtAnyCentre('consultation_summary')).toBe(true);
    expect(documentReadAtAnyCentre('referral_letter')).toBe(true);
    expect(documentReadAtAnyCentre('discharge_report')).toBe(true);
    expect(documentReadAtAnyCentre('invoice_receipt')).toBe(false);
  });

  it('lists each document once, newest version first, the latest document first', () => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day));
    const summary = (version: number, day: number) => ({
      kind: 'consultation_summary' as const,
      sourceId: 'consultation-1',
      version,
      createdAt: at(day),
    });
    const letter = {
      kind: 'referral_letter' as const,
      sourceId: 'consultation-1',
      version: 1,
      createdAt: at(3),
    };
    const series = documentSeries([letter, summary(1, 1), summary(2, 5)]);
    expect(
      series.map((s) => [s.latest.kind, s.latest.version, s.earlier.map((e) => e.version)]),
    ).toEqual([
      ['consultation_summary', 2, [1]],
      ['referral_letter', 1, []],
    ]);
    expect(documentSeries([])).toEqual([]);
  });

  it('puts the centre on the letterhead and leaves out what it does not have yet', () => {
    expect(
      letterheadLines({ name: 'HSR Layout', address: '27th Main, HSR', phone: '+918041234567' }),
    ).toEqual(['Movementology Clinics', 'HSR Layout', '27th Main, HSR', '+91 80 4123 4567']);
    expect(letterheadLines({ name: 'Whitefield', address: null, phone: null })).toEqual([
      'Movementology Clinics',
      'Whitefield',
    ]);
  });
});

describe('document dates and numbers', () => {
  it('prints the IST date with its own month names', () => {
    expect(documentDate(new Date('2026-09-28T10:35:00Z'))).toBe('28 Sep 2026');
    // 20:00 UTC is already the next day in IST.
    expect(documentDate(new Date('2026-12-31T20:00:00Z'))).toBe('1 Jan 2027');
  });

  it('prints a 12 hour IST time', () => {
    expect(documentTime(new Date('2026-09-28T10:35:00Z'))).toBe('4:05 PM');
    expect(documentTime(new Date('2026-09-27T18:30:00Z'))).toBe('12:00 AM');
    expect(documentTime(new Date('2026-09-28T06:30:00Z'))).toBe('12:00 PM');
    expect(documentTime(new Date('2026-09-28T06:29:00Z'))).toBe('11:59 AM');
    expect(documentDateTime(new Date('2026-09-28T10:35:00Z'))).toBe('28 Sep 2026, 4:05 PM');
  });

  it('groups counts the Indian way', () => {
    expect(indianNumber(99_999)).toBe('99,999');
    expect(indianNumber(1_00_000)).toBe('1,00,000');
    expect(indianNumber(18_40_000)).toBe('18,40,000');
  });
});
