import { describe, expect, it } from 'vitest';
import {
  comparedTopCount,
  dismissedShare,
  inTopPercent,
  istMonthBounds,
  kbReportBodySchema,
  kbReportTitle,
  labelSections,
  nextKbReportRun,
  oftenDismissed,
  topWords,
  type ConfirmedLabel,
} from './kb-report';

// AI-08: the monthly knowledge base report's month, definitions and shape (DECISION AI-08).
const label = (extra: Partial<ConfirmedLabel> = {}): ConfirmedLabel => ({
  conditionId: 'KNE-004',
  name: 'Fake Tendinopathy',
  stage: 'review',
  fromId: 'KNE-004',
  fromName: 'Fake Tendinopathy',
  sheet: 'ranked',
  inTop: true,
  inAlsoConsider: false,
  onShortlist: true,
  inRecheckTop: false,
  topSize: 3,
  ...extra,
});

describe('the monthly knowledge base report', () => {
  it('counts a month in IST, and runs on the 1st of the next at 01:00 IST', () => {
    const { start, end } = istMonthBounds('2026-10');
    expect(start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    // 11:59:59 PM IST on 31 October is October; midnight is November.
    expect(new Date('2026-10-31T18:29:59Z') < end).toBe(true);
    expect(new Date('2026-10-31T18:30:00Z') < end).toBe(false);
    expect(nextKbReportRun('2026-10')).toEqual({
      month: '2026-11',
      runAt: new Date('2026-11-30T19:30:00Z'),
    });
    expect(nextKbReportRun('2026-12').month).toBe('2027-01');
    expect(kbReportTitle('2026-10')).toBe('Knowledge base report for Oct 2026');
  });

  it('calls a suggestion often dismissed only past both thresholds', () => {
    const row = (kept: number, dismissed: number) => ({
      kbVersionNumber: 1,
      conditionId: `KNE-0${String(kept)}${String(dismissed)}`,
      name: 'Fake condition',
      kept,
      dismissed,
    });
    expect(dismissedShare(1, 2)).toBe(66);
    expect(dismissedShare(0, 0)).toBe(0);
    const thresholds = { minMarked: 5, sharePercent: 50 };
    // 4 marked is too few; 5 at 40% too low; 5 at 60% and 6 at 50% are in, highest share first.
    expect(
      oftenDismissed([row(1, 3), row(3, 2), row(2, 3), row(3, 3)], thresholds).map((r) => [
        r.kept,
        r.dismissed,
        r.sharePercent,
      ]),
    ).toEqual([
      [2, 3, 60],
      [3, 3, 50],
    ]);
  });

  it('grades each miss by how near it came, compares only on one version, and counts changes', () => {
    const sections = labelSections([
      label(),
      label({ inTop: false, inAlsoConsider: true, inRecheckTop: true }),
      label({ inTop: false, onShortlist: true }),
      label({ inTop: false, onShortlist: false }),
      label({ sheet: 'other_version', inTop: false }),
      label({ sheet: 'no_ranking', inTop: false }),
      label({ fromId: 'KNE-001', fromName: 'Fake Pain Syndrome', stage: 'discharge' }),
    ]);
    expect(sections.totals).toEqual({
      labels: 7,
      labelsCompared: 5,
      inTop: 2,
      labelsWithoutRanking: 1,
      labelsOtherVersion: 1,
      changed: 1,
    });
    expect(sections.missed).toEqual([
      {
        conditionId: 'KNE-004',
        name: 'Fake Tendinopathy',
        count: 3,
        alsoConsider: 1,
        shortlistedNotSuggested: 1,
        notShortlisted: 1,
        foundAtRecheck: 1,
      },
    ]);
    expect(sections.changed).toEqual([
      {
        fromId: 'KNE-001',
        fromName: 'Fake Pain Syndrome',
        toId: 'KNE-004',
        toName: 'Fake Tendinopathy',
        stage: 'discharge',
        count: 1,
      },
    ]);
    expect(inTopPercent(sections.totals)).toBe(40);
    expect(inTopPercent({ labelsCompared: 0, inTop: 0 })).toBeNull();
    // The top size is the compared sheets' own; mixed sizes say so in words.
    expect(comparedTopCount([label(), label({ topSize: 3 })])).toBe(3);
    expect(comparedTopCount([label(), label({ topSize: 5 })])).toBeNull();
    expect(comparedTopCount([label({ sheet: 'no_ranking', topSize: 0 })])).toBeNull();
    expect(topWords(3)).toBe('the top 3');
    expect(topWords(null)).toBe('the top suggestions');
  });

  it('holds counts and knowledge base names only, never an episode, patient or staff', () => {
    const body = {
      month: '2026-10',
      kbVersions: [{ id: '00000000-0000-4000-8000-000000000c01', number: 1 }],
      thresholds: { minMarked: 5, sharePercent: 50, topCount: 3 },
      totals: {
        sheetsReady: 0,
        sheetsUnavailable: 0,
        marked: 0,
        unmarked: 0,
        labels: 0,
        labelsCompared: 0,
        inTop: 0,
        labelsWithoutRanking: 0,
        labelsOtherVersion: 0,
        changed: 0,
      },
      oftenDismissed: [],
      missed: [],
      changed: [],
    };
    expect(kbReportBodySchema.safeParse(body).success).toBe(true);
    expect(
      kbReportBodySchema.safeParse({ ...body, episodeId: '00000000-0000-4000-8000-000000000e01' })
        .success,
    ).toBe(false);
    expect(
      kbReportBodySchema.safeParse({
        ...body,
        missed: [
          {
            conditionId: 'KNE-004',
            name: 'Fake',
            count: 1,
            alsoConsider: 0,
            shortlistedNotSuggested: 0,
            notShortlisted: 1,
            foundAtRecheck: 0,
            patientName: 'Test Patient',
          },
        ],
      }).success,
    ).toBe(false);
    expect(kbReportBodySchema.safeParse({ ...body, month: '2026-13' }).success).toBe(false);
  });
});
