import { describe, expect, it } from 'vitest';
import {
  baselineBlockers,
  baselineEntrySchema,
  baselineMarkers,
  baselineReadingText,
  baselineRecordings,
  consultationRegion,
  entryOfReadings,
  episodeBaseline,
  measureValueText,
  type TakenMeasure,
} from './baseline';
import { consultationSectionsSchema } from './consultations';
import type { KnowledgeMeasure } from './objective';
import { emptySessionNote, sessionNoteBlockers, sessionNoteSchema } from './sessions';

const measure = (extra: Partial<KnowledgeMeasure>): KnowledgeMeasure => ({
  key: 'knee.marker.primary_task_pain_nrs_0_10', // gitleaks:allow
  region: 'knee',
  section: 'RE-TESTABLE MARKERS — BASELINE vs CURRENT',
  name: 'Primary task pain (NRS 0-10)',
  unit: '/10',
  kind: 'marker',
  inverted: false,
  rule: { kind: 'none' },
  direction: 'Lower is better',
  note: null,
  ...extra,
});

const quadriceps = measure({
  key: 'knee.lsi.quadriceps', // gitleaks:allow
  section: 'STRENGTH — LIMB SYMMETRY INDEX (target >=90%)',
  name: 'Quadriceps',
  unit: 'kg',
  kind: 'lsi',
  rule: { kind: 'lsi', passAt: 0.9 },
  direction: null,
});
const pain = measure({});
const effusion = measure({
  key: 'knee.marker.effusion_grade_0_3', // gitleaks:allow
  name: 'Effusion grade (0-3)',
  unit: 'grade',
  kind: 'grade',
});
const neckPain = measure({
  key: 'cervical.marker.neck_pain', // gitleaks:allow
  region: 'cervical',
  name: 'Neck pain',
});
const catalog = [quadriceps, pain, effusion, neckPain];

const startedAt = new Date('2026-11-10T04:30:00Z');
const DAY = 24 * 60 * 60 * 1000;
const before = (ms: number) => new Date(startedAt.getTime() - ms);
const row = (extra: Partial<TakenMeasure>): TakenMeasure => ({
  key: pain.key,
  limb: null,
  value: 6,
  takenAt: before(3 * DAY),
  consultationId: 'c1',
  ...extra,
});

// OUT-01 done when: consultation measures within 7 days are reused and the missing markers are
// requested at session 1. Decisions (user, 26 October 2026): the region's markers always, plus
// anything else the consultation took; the window runs back from session 1's start.
describe('the episode baseline', () => {
  it('reuses consultation measures within the window and asks for the region markers without one', () => {
    const baseline = episodeBaseline({
      catalog,
      region: 'knee',
      taken: [
        row({}),
        row({ key: quadriceps.key, limb: 'involved', value: 32 }),
        row({ key: quadriceps.key, limb: 'uninvolved', value: 40 }),
      ],
      startedAt,
      reuseDays: 7,
    });
    expect(baseline.reused.map((r) => [r.measure.key, r.entry])).toEqual([
      [quadriceps.key, { involved: 32, uninvolved: 40 }],
      [pain.key, { value: 6 }],
    ]);
    expect(baseline.reused[0]?.result).toEqual({ lsi: 0.8, status: 'not_yet' });
    // The LSI is reused but never asked for; only the region's markers are.
    expect(baseline.missing.map((m) => m.key)).toEqual([effusion.key]);
  });

  it('counts exactly the setting’s days back from session 1, and nothing after it started', () => {
    const at = (takenAt: Date) =>
      episodeBaseline({
        catalog,
        region: 'knee',
        taken: [row({ takenAt })],
        startedAt,
        reuseDays: 7,
      }).reused.length;
    expect(at(before(7 * DAY))).toBe(1);
    expect(at(before(7 * DAY + 60_000))).toBe(0);
    expect(at(new Date(startedAt.getTime() + 60_000))).toBe(0);
    // A later session 1 asks for every marker again.
    const late = episodeBaseline({
      catalog,
      region: 'knee',
      taken: [row({ takenAt: before(8 * DAY) })],
      startedAt,
      reuseDays: 7,
    });
    expect(late.missing.map((m) => m.key)).toEqual([pain.key, effusion.key]);
  });

  it('takes the newest consultation’s reading of a measure', () => {
    const baseline = episodeBaseline({
      catalog,
      region: 'knee',
      taken: [
        row({ value: 7, takenAt: before(5 * DAY), consultationId: 'old' }),
        row({ value: 4, takenAt: before(2 * DAY), consultationId: 'new' }),
      ],
      startedAt,
      reuseDays: 7,
    });
    expect(baseline.reused).toHaveLength(1);
    expect(baseline.reused[0]).toMatchObject({ entry: { value: 4 }, consultationId: 'new' });
  });

  it('asks for nothing when the region is not known, and leaves out what the catalog lacks', () => {
    const baseline = episodeBaseline({
      catalog,
      region: '',
      taken: [row({ key: 'knee.marker.retired' })], // gitleaks:allow
      startedAt,
      reuseDays: 7,
    });
    expect(baseline).toEqual({ reused: [], missing: [] });
    expect(baselineMarkers(catalog, 'cervical')).toEqual([neckPain]);
  });

  it('reads the region from the Objective, or else the screening region', () => {
    const sections = consultationSectionsSchema.parse({ objective: { region: 'hip' } });
    expect(consultationRegion(sections, { region: 'knee' })).toBe('hip');
    expect(consultationRegion(consultationSectionsSchema.parse({}), { region: 'back' })).toBe(
      'lumbar_sij',
    );
    expect(consultationRegion(consultationSectionsSchema.parse({}), {})).toBe('');
  });

  it('writes values the way the workbook reads them', () => {
    expect(measureValueText(pain, 6)).toBe('6/10');
    expect(measureValueText(effusion, 2)).toBe('2');
    expect(measureValueText(quadriceps, 32)).toBe('32 kg');
    expect(
      baselineReadingText(
        quadriceps,
        entryOfReadings([
          { limb: 'involved', value: 32 },
          { limb: 'uninvolved', value: 40 },
        ]),
      ),
    ).toBe('Involved 32 kg, uninvolved 40 kg · LSI 80% · Not yet');
    expect(baselineReadingText(pain, entryOfReadings([{ limb: null, value: 6 }]))).toBe('6/10');
  });
});

describe('session 1’s baseline entries', () => {
  const missing = [pain, effusion];
  const entry = (extra: object) => baselineEntrySchema.parse(extra);

  it('holds Close session until each missing marker is recorded or not tested with a reason', () => {
    expect(baselineBlockers({}, missing)).toEqual([
      'Record Primary task pain (NRS 0-10), or mark it Not tested with a reason.',
      'Record Effusion grade (0-3), or mark it Not tested with a reason.',
    ]);
    expect(
      baselineBlockers(
        {
          [pain.key]: entry({ value: 5 }),
          [effusion.key]: entry({ notTested: true, reason: ' ' }),
        },
        missing,
      ),
    ).toEqual(['Give the reason Effusion grade (0-3) was not tested.']);
    expect(baselineBlockers({ [effusion.key]: entry({ value: 4 }) }, [effusion])).toEqual([
      'Rate Effusion grade (0-3) from 0 to 3.',
    ]);
    expect(baselineBlockers({ [effusion.key]: entry({ value: 1.5 }) }, [effusion])).toHaveLength(1);
    const done = {
      [pain.key]: entry({ value: 5 }),
      [effusion.key]: entry({ notTested: true, reason: ' Swelling not assessable ', value: 2 }),
    };
    expect(baselineBlockers(done, missing)).toEqual([]);
    // Not tested wins over a value left behind; entries for markers not asked for are dropped.
    expect(
      baselineRecordings({ ...done, [quadriceps.key]: entry({ value: 30 }) }, missing),
    ).toEqual([
      { key: pain.key, value: 5, unit: '/10' },
      { key: effusion.key, notTestedReason: 'Swelling not assessable' },
    ]);
  });

  it('sits in the session note, which closes on it, and older notes still read', () => {
    const note = sessionNoteSchema.parse({});
    expect(note.baseline).toEqual({});
    expect(sessionNoteBlockers(emptySessionNote(), [], [effusion])).toContain(
      'Record Effusion grade (0-3), or mark it Not tested with a reason.',
    );
    expect(sessionNoteSchema.safeParse({ baseline: { 'Not a key': {} } }).success).toBe(false);
    expect(
      sessionNoteSchema.safeParse({ baseline: { [pain.key]: { reason: 'x'.repeat(201) } } })
        .success,
    ).toBe(false);
  });
});
