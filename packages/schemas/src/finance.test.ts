import { describe, expect, it } from 'vitest';
import { addMonths, csvCell, csvRupees, monthLabel, monthOf, monthsEnding, toCsv } from './finance';

// DSH-04: the pure parts of Finance's dashboards.
describe('months', () => {
  it('steps across years', () => {
    expect(monthOf('2026-10-28')).toBe('2026-10');
    expect(addMonths('2026-10', 3)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', -12)).toBe('2025-10');
    expect(monthsEnding('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthLabel('2026-10')).toBe('Oct');
    expect(monthLabel('2025-10', true)).toMatch(/Oct.*2025/);
  });
});

describe('CSV', () => {
  it('quotes what needs quoting and never lets a cell run as a formula', () => {
    expect(csvCell('HSR Layout')).toBe('HSR Layout');
    expect(csvCell('Consultation, senior')).toBe('"Consultation, senior"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+91 99')).toBe("'+91 99");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(1500)).toBe('1500');
    expect(csvRupees(150_050)).toBe('1500.50');
    expect(toCsv(['Day', 'Rupees'], [['2026-10-28', '1500.00']])).toBe(
      'Day,Rupees\r\n2026-10-28,1500.00\r\n',
    );
  });
});
