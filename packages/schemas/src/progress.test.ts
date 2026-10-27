import { describe, expect, it } from 'vitest';
import type { KnowledgeMeasure } from './objective';
import { patientRecordTabs } from './patient-record';
import { lsiBullets, painPoints, painSentence } from './progress';

// OUT-03 (user decisions 27 October 2026): pain during activity from the consultation over the
// signed sessions; an LSI bullet per strength or hop measure, the newest against its pass, the
// first marked.
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 5));
const quadriceps: KnowledgeMeasure = {
  key: 'knee.lsi.quadriceps', // gitleaks:allow
  region: 'knee',
  section: 'STRENGTH',
  name: 'Quadriceps',
  unit: 'kg',
  kind: 'lsi',
  inverted: false,
  rule: { kind: 'lsi', passAt: 0.9 },
  direction: null,
  note: null,
};
const timedHop: KnowledgeMeasure = {
  ...quadriceps,
  key: 'knee.lsi.6_m_timed_hop', // gitleaks:allow
  name: '6 m timed hop',
  unit: 'sec',
  inverted: true,
};
const effusion: KnowledgeMeasure = {
  ...quadriceps,
  key: 'knee.marker.effusion', // gitleaks:allow
  name: 'Effusion',
  kind: 'marker',
  rule: { kind: 'none' },
};
const taking = (involved: number, uninvolved: number, n: number) => ({
  entry: { involved, uninvolved },
  at: day(n),
  from: `session, ${String(n)} Oct 2026`,
});

describe('the Progress tab', () => {
  it('sits between Notes and Documents', () => {
    expect(patientRecordTabs).toEqual(['overview', 'notes', 'progress', 'documents', 'alerts']);
  });

  it('starts the pain line at the consultation and follows the sessions in order, gaps kept', () => {
    const points = painPoints({ at: day(1), now: 3, activity: 6 }, [
      { number: 2, at: day(8), pain: { rest: 1, activity: 2, after: 0 } },
      { number: 1, at: day(4), pain: { rest: 2, activity: 4, after: 1 } },
    ]);
    expect(points.map((p) => [p.label, p.activity, p.rest, p.after])).toEqual([
      ['Consultation', 6, 3, null],
      ['Session 1', 4, 2, 1],
      ['Session 2', 2, 1, 0],
    ]);
    expect(painSentence(points)).toBe(
      'Pain during activity 6 at the consultation, 2 at session 2.',
    );
    // A pain the health form left out, or not a 0 to 10 whole number, is a gap.
    const gaps = painPoints({ at: day(1), now: undefined, activity: 'severe' }, [
      { number: 1, at: day(4), pain: { rest: 2, activity: 4, after: 1 } },
    ]);
    expect(gaps.map((p) => p.activity)).toEqual([null, 4]);
    expect(painSentence(gaps)).toBe('Pain during activity 4 at session 1.');
    expect(painSentence(painPoints(undefined, []))).toBeNull();
  });

  it('bullets each LSI measure: the newest against its pass, the first marked, inverted ones right way up', () => {
    const bullets = lsiBullets(
      [quadriceps, timedHop, effusion],
      new Map([
        [quadriceps.key, { latest: taking(38, 40, 20), first: taking(32, 40, 1) }],
        [timedHop.key, { latest: taking(2.4, 2, 20), first: taking(2.4, 2, 20) }],
        [effusion.key, { latest: taking(1, 1, 20), first: taking(1, 1, 20) }],
      ]),
    );
    expect(bullets).toEqual([
      expect.objectContaining({
        name: 'Quadriceps',
        latest: 0.95,
        baseline: 0.8,
        passAt: 0.9,
        passes: true,
        from: 'session, 20 Oct 2026',
      }),
      // Slower on the involved side: 2 / 2.4, below the pass; only one test, so no mark.
      expect.objectContaining({ name: '6 m timed hop', baseline: null, passes: false }),
    ]);
    expect(bullets[1]?.latest).toBeCloseTo(0.833, 3);
    // A measure never taken, or taken one side only, has no bullet.
    expect(
      lsiBullets(
        [quadriceps],
        new Map([
          [
            quadriceps.key,
            {
              latest: { entry: { involved: 30 }, at: day(2), from: 'x' },
              first: { entry: { involved: 30 }, at: day(2), from: 'x' },
            },
          ],
        ]),
      ),
    ).toEqual([]);
    expect(lsiBullets([quadriceps], new Map())).toEqual([]);
  });
});
