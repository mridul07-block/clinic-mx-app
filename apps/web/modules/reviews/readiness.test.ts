import type { Db, StaffMember } from '@clinic-mx/db';
import type { KnowledgeMeasure, ReadinessCriterion } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { ReviewError } from './errors';
import {
  markReadinessCheck,
  overrideReadinessCriterion,
  readinessView,
  recordReadinessMeasure,
  signReadinessClearance,
} from './readiness';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  addReadinessMark: vi.fn(),
  clearancesOf: vi.fn(),
  episodeReadings: vi.fn(),
  episodeRecord: vi.fn(),
  knowledgeObjective: vi.fn(),
  latestCriteriaVersion: vi.fn(),
  readinessCriteria: vi.fn(),
  readinessMarks: vi.fn(),
  recordReadinessReading: vi.fn(),
  signClearance: vi.fn(),
  staffTreatsNow: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../sessions/baseline', () => ({ episodeRegion: vi.fn().mockResolvedValue('knee') }));

const hsr = '00000000-0000-4000-8000-000000000101';
const episodeId = '00000000-0000-4000-8000-000000000501';
const consultant: StaffMember = {
  id: '00000000-0000-4000-8000-000000000207',
  email: 'consultant@clinicmx.test',
  name: 'Dr Test Consultant',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: true,
  centreIds: [hsr],
  support: false,
};
const physio: StaffMember = {
  ...consultant,
  id: '00000000-0000-4000-8000-000000000208',
  consultant: false,
};
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
const hamstrings: KnowledgeMeasure = {
  ...quadriceps,
  key: 'knee.lsi.hamstrings', // gitleaks:allow
  name: 'Hamstrings',
};
const measured = (m: KnowledgeMeasure): ReadinessCriterion => ({
  key: m.key,
  region: 'knee',
  kind: 'measure',
  measureKey: m.key,
  text: m.name,
  section: 'STRENGTH',
  rule: { kind: 'measure' },
  fromVerdict: false,
});
const valgus: ReadinessCriterion = {
  key: 'knee.readiness.no_dynamic_valgus', // gitleaks:allow
  region: 'knee',
  kind: 'check',
  measureKey: null,
  text: 'No dynamic valgus on single-leg tasks and landing',
  section: 'RETURN-TO-SPORT READINESS SUMMARY',
  rule: { kind: 'yes' },
  fromVerdict: false,
};
const context = (actor: StaffMember) => ({ db: {} as Db, actor });

// OUT-08 (user decisions 27 October 2026): each criterion Met, Not met or Not assessed from the
// newest reading or the consultant's mark; overrides with a reason; three clearances in order.
describe('the readiness panel', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.episodeRecord.mockResolvedValue({ id: episodeId, status: 'active' });
    db.latestCriteriaVersion.mockResolvedValue('kb-2');
    db.readinessCriteria.mockResolvedValue([measured(quadriceps), measured(hamstrings), valgus]);
    db.knowledgeObjective.mockResolvedValue({ measures: [quadriceps, hamstrings] });
    db.episodeReadings.mockResolvedValue(
      new Map([
        [
          quadriceps.key,
          {
            latest: {
              entry: { involved: 38, uninvolved: 40 },
              source: 'final_test',
              takenAt: new Date('2026-10-27T05:00:00Z'),
            },
            first: {
              entry: { involved: 32, uninvolved: 40 },
              source: 'consultation',
              takenAt: new Date(),
            },
          },
        ],
      ]),
    );
    db.readinessMarks.mockResolvedValue(new Map());
    db.clearancesOf.mockResolvedValue([]);
    db.staffTreatsNow.mockResolvedValue(true);
  });

  it('judges each criterion and blocks the clearances until each is Met or overridden', async () => {
    const view = await readinessView(fakeTx as never, episodeId);
    expect(view?.rows.map((row) => [row.criterion.text, row.result, row.readingFrom])).toEqual([
      ['Quadriceps', 'met', 'final testing, 27 Oct 2026'],
      ['Hamstrings', 'not_assessed', null],
      ['No dynamic valgus on single-leg tasks and landing', 'not_assessed', null],
    ]);
    expect(view?.clearances.map((c) => c.refusal)).toEqual([
      '2 tests not assessed. Record them or add an override reason.',
      'Sign Rehabilitation complete first.',
      'Sign Return to training first.',
    ]);
    db.readinessMarks.mockResolvedValue(
      new Map([
        [valgus.key, { check: { result: 'met', by: consultant.name, at: new Date() } }],
        [
          hamstrings.key,
          { override: { reason: 'Not tested.', by: consultant.name, at: new Date() } },
        ],
      ]),
    );
    expect(
      (await readinessView(fakeTx as never, episodeId))?.clearances[0]?.refusal,
    ).toBeUndefined();
  });

  it('signs a clearance keeping every criterion as it stands', async () => {
    db.readinessMarks.mockResolvedValue(
      new Map([
        [valgus.key, { check: { result: 'met', by: consultant.name, at: new Date() } }],
        [
          hamstrings.key,
          { override: { reason: 'Not tested.', by: consultant.name, at: new Date() } },
        ],
      ]),
    );
    await expect(
      signReadinessClearance(context(consultant), { episodeId, status: 'rehabilitation_complete' }),
    ).resolves.toEqual({ status: 'signed' });
    expect(db.signClearance).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      status: 'rehabilitation_complete',
      region: 'knee',
      kbVersionId: 'kb-2',
      by: consultant.id,
      criteria: [
        {
          key: quadriceps.key,
          text: 'Quadriceps',
          result: 'met',
          reading: 'Involved 38 kg, uninvolved 40 kg · LSI 95% · Pass',
          override: null,
        },
        {
          key: hamstrings.key,
          text: 'Hamstrings',
          result: 'not_assessed',
          reading: null,
          override: 'Not tested.',
        },
        { key: valgus.key, text: valgus.text, result: 'met', reading: null, override: null },
      ],
    });
  });

  it('refuses a blocked or out of order clearance, a physio, no tick, an untreated episode and support', async () => {
    const sign = (actor: StaffMember, status = 'rehabilitation_complete') =>
      signReadinessClearance(context(actor), { episodeId, status });
    await expect(sign(consultant)).rejects.toThrow(
      new ReviewError('2 tests not assessed. Record them or add an override reason.'),
    );
    await expect(sign(consultant, 'return_to_sport')).rejects.toThrow(
      'Sign Return to training first.',
    );
    await expect(sign(physio)).rejects.toThrow(NotAllowedError);
    db.staffTreatsNow.mockResolvedValueOnce(false);
    await expect(sign(consultant)).rejects.toThrow('Readiness needs the Treats patients tick.');
    db.episodeRecord.mockResolvedValueOnce({ id: episodeId, status: 'discharged' });
    await expect(sign(consultant)).rejects.toThrow(
      'Readiness is recorded while the episode is Active or Under review.',
    );
    await expect(sign({ ...consultant, support: true })).rejects.toThrow(ReadOnlyError);
    expect(db.signClearance).not.toHaveBeenCalled();
  });

  it('marks a yes or no criterion, overrides one not Met, and records a missing reading', async () => {
    await markReadinessCheck(context(consultant), {
      episodeId,
      criterionKey: valgus.key,
      result: 'met',
    });
    expect(db.addReadinessMark).toHaveBeenLastCalledWith(fakeTx, {
      episodeId,
      kbVersionId: 'kb-2',
      criterionKey: valgus.key,
      by: consultant.id,
      kind: 'check',
      result: 'met',
    });
    await expect(
      markReadinessCheck(context(consultant), {
        episodeId,
        criterionKey: quadriceps.key,
        result: 'met',
      }),
    ).rejects.toThrow('A measured criterion is judged by its reading.');
    await overrideReadinessCriterion(context(consultant), {
      episodeId,
      criterionKey: hamstrings.key,
      reason: ' Not tested at discharge. ',
    });
    expect(db.addReadinessMark).toHaveBeenLastCalledWith(
      fakeTx,
      expect.objectContaining({ kind: 'override', reason: 'Not tested at discharge.' }),
    );
    await expect(
      overrideReadinessCriterion(context(consultant), {
        episodeId,
        criterionKey: quadriceps.key,
        reason: 'x',
      }),
    ).rejects.toThrow('This criterion is Met; there is nothing to override.');

    await recordReadinessMeasure(context(consultant), {
      episodeId,
      criterionKey: hamstrings.key,
      involved: 36,
      uninvolved: 40,
    });
    expect(db.recordReadinessReading).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      kbVersionId: 'kb-2',
      by: consultant.id,
      readings: [
        { key: hamstrings.key, limb: 'involved', value: 36, unit: 'kg' },
        { key: hamstrings.key, limb: 'uninvolved', value: 40, unit: 'kg' },
      ],
    });
    await expect(
      recordReadinessMeasure(context(consultant), {
        episodeId,
        criterionKey: hamstrings.key,
        involved: 36,
      }),
    ).rejects.toThrow('Record both sides of Hamstrings, or mark it Not tested with a reason.');
    await expect(
      recordReadinessMeasure(context(consultant), {
        episodeId,
        criterionKey: quadriceps.key,
        involved: 1,
        uninvolved: 2,
      }),
    ).rejects.toThrow('This criterion is judged from its reading already.');
    await expect(
      recordReadinessMeasure(context(consultant), {
        episodeId,
        criterionKey: valgus.key,
        value: 1,
      }),
    ).rejects.toThrow('A yes or no criterion is marked, not measured.');
  });
});
