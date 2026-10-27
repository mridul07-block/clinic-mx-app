import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  kpiCatalogue,
  kpiPeriodDays,
  kpiStatus,
  kpiTally,
  kpiTargetText,
  kpiText,
  kpiValue,
  measuredKpiKeys,
  type KpiDailyRow,
} from './kpis';
import { settingDefinitions } from './settings';

// DSH-01 done when: every metric in PRD section 9 has a figure, measured or naming what brings it.
const prd = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'docs', 'Clinic_Mx_PRD.md'),
  'utf8',
);

/** The "Metric | Target | Source" rows of PRD section 9: [metric, target]. */
function prdSectionNine(): [string, string][] {
  const section = prd.split(/^## /m).find((part) => part.startsWith('9. Success metrics'));
  if (!section) throw new Error('PRD section 9 not found');
  return section
    .split('\n')
    .filter(
      (line) => line.startsWith('| ') && !line.startsWith('| Metric') && !line.startsWith('| ---'),
    )
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      return [cells[1] ?? '', cells[2] ?? ''];
    });
}

describe('the figures catalogue', () => {
  it('has a figure for every PRD section 9 metric, with its target as a setting', () => {
    const metrics = prdSectionNine();
    expect(metrics).toHaveLength(14);
    const prdFigures = kpiCatalogue.filter((figure) => figure.prd);
    expect(prdFigures).toHaveLength(metrics.length);
    for (const figure of prdFigures) {
      if (!figure.target) {
        // Only the two the PRD gives no number: tracked monthly, or set after 3 months.
        expect(figure.targetNote).toBeTruthy();
        continue;
      }
      expect(Object.hasOwn(settingDefinitions, figure.target.setting)).toBe(true);
      expect(settingDefinitions[figure.target.setting].source).toContain('PRD section 9');
    }
    // Each PRD target's wording is the catalogue's comparison.
    const byLabel = new Map(metrics);
    expect(byLabel.get('Consultation to treatment conversion')).toBe('Over 75%');
    expect(byLabel.get('Reinjury within 12 months')).toBe('Under 15%');
    expect(byLabel.get('Red flag documentation')).toBe('100% of initial assessments');
  });

  it('measures exactly the figures the database returns, and names what the others need', () => {
    const measured = kpiCatalogue.filter((figure) => figure.measured === true).map((f) => f.key);
    expect(measured.sort()).toEqual([...measuredKpiKeys].sort());
    for (const figure of kpiCatalogue) {
      if (figure.measured !== true)
        expect(figure.measured.needs).toMatch(/[A-Z]{2,3}-\d\d|decision/i);
    }
    expect(new Set(kpiCatalogue.map((figure) => figure.key)).size).toBe(kpiCatalogue.length);
    expect(kpiCatalogue.find((figure) => figure.key === 'revenue')?.audience).toBe('finance');
  });
});

describe('a figure’s value and status', () => {
  it('divides a share, and has no value with nothing to divide', () => {
    expect(kpiValue({ numerator: 3, denominator: 4 }, 'percent')).toBe(75);
    expect(kpiValue({ numerator: 0, denominator: 0 }, 'percent')).toBeNull();
    expect(kpiValue({ numerator: 0, denominator: null }, 'percent')).toBeNull();
    expect(kpiValue({ numerator: 12, denominator: null }, 'count')).toBe(12);
    expect(kpiText(75.4, 'percent')).toBe('75%');
    expect(kpiText(null, 'percent')).toBe('No data yet');
    expect(kpiText(1_840_000, 'paise')).toBe('₹18,400');
    // Dashboards show money in lakhs (Frontend Specification section 4).
    expect(kpiText(184_000_000, 'paise')).toBe('₹18.4 L');
  });

  it('never rounds a share across its target', () => {
    const atLeast100 = { value: 100, comparison: 'at_least' } as const;
    const over75 = { value: 75, comparison: 'above' } as const;
    const under15 = { value: 15, comparison: 'below' } as const;
    // 199 of 200 is not "100%" under a 100% target.
    expect(kpiText(99.5, 'percent', atLeast100)).toBe('99.5%');
    expect(kpiText(99.96, 'percent', atLeast100)).toBe('99.9%');
    expect(kpiText(100, 'percent', atLeast100)).toBe('100%');
    // 76 of 101 is over 75, so it is not shown as 75%.
    expect(kpiText((76 / 101) * 100, 'percent', over75)).toBe('75.3%');
    // 74.87 shows 75%, which is not over 75%: the same side either way.
    expect(kpiText((149 / 199) * 100, 'percent', over75)).toBe('75%');
    expect(kpiText(80.4, 'percent', over75)).toBe('80%');
    expect(kpiText(14.6, 'percent', under15)).toBe('14.6%');
    expect(kpiText(15.2, 'percent', under15)).toBe('15%');
    expect(kpiText(74.6, 'percent')).toBe('75%');
  });

  it('reads over, at least and under the way the PRD words them', () => {
    expect(kpiStatus(75, { value: 75, comparison: 'above' })).toBe('off_target');
    expect(kpiStatus(76, { value: 75, comparison: 'above' })).toBe('on_target');
    expect(kpiStatus(100, { value: 100, comparison: 'at_least' })).toBe('on_target');
    expect(kpiStatus(99.5, { value: 100, comparison: 'at_least' })).toBe('off_target');
    expect(kpiStatus(14, { value: 15, comparison: 'below' })).toBe('on_target');
    expect(kpiStatus(15, { value: 15, comparison: 'below' })).toBe('off_target');
    expect(kpiStatus(null, { value: 15, comparison: 'below' })).toBe('no_data');
    expect(kpiStatus(40, null)).toBeNull();
    expect(kpiTargetText(75, 'above', 'percent')).toBe('Over 75%');
    expect(kpiTargetText(100, 'at_least', 'percent')).toBe('100%');
    expect(kpiTargetText(3, 'below', 'minutes')).toBe('Under 3 minutes');
  });
});

describe('a figure over a period', () => {
  const rows: KpiDailyRow[] = [
    { centreId: 'a', day: '2026-10-20', metric: 'no_show_rate', numerator: 1, denominator: 10 },
    { centreId: 'b', day: '2026-10-27', metric: 'no_show_rate', numerator: 2, denominator: 10 },
    { centreId: 'a', day: '2026-10-28', metric: 'no_show_rate', numerator: 0, denominator: 5 },
    {
      centreId: 'a',
      day: '2026-10-27',
      metric: 'active_patients',
      numerator: 40,
      denominator: null,
    },
    {
      centreId: 'a',
      day: '2026-10-28',
      metric: 'active_patients',
      numerator: 41,
      denominator: null,
    },
    {
      centreId: 'b',
      day: '2026-10-28',
      metric: 'active_patients',
      numerator: 9,
      denominator: null,
    },
    // All centres: one patient is treated at both.
    {
      centreId: null,
      day: '2026-10-28',
      metric: 'active_patients',
      numerator: 49,
      denominator: null,
    },
  ];

  it('sums the days of a share, at one centre or all', () => {
    const week = kpiPeriodDays('week', '2026-10-28');
    expect(week).toEqual({ from: '2026-10-22', to: '2026-10-28' });
    const figure = { key: 'no_show_rate', over: 'sum' } as const;
    expect(kpiTally(rows, figure, week.from, week.to)).toEqual({ numerator: 2, denominator: 15 });
    expect(kpiTally(rows, figure, week.from, week.to, 'a')).toEqual({
      numerator: 0,
      denominator: 5,
    });
    const month = kpiPeriodDays('month', '2026-10-28');
    expect(kpiTally(rows, figure, month.from, month.to)).toEqual({
      numerator: 3,
      denominator: 25,
    });
    expect(kpiPeriodDays('today', '2026-10-28')).toEqual({ from: '2026-10-28', to: '2026-10-28' });
  });

  it('takes the last day of a count at the end of a day, each patient once in all', () => {
    const figure = { key: 'active_patients', over: 'last' } as const;
    expect(kpiTally(rows, figure, '2026-10-22', '2026-10-28')).toEqual({
      numerator: 49,
      denominator: null,
    });
    expect(kpiTally(rows, figure, '2026-10-22', '2026-10-28', 'a').numerator).toBe(41);
  });
});
