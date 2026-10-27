import type { Db, StaffMember } from '@clinic-mx/db';
import type { KnowledgeMeasure } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { ReviewError, loadReview, signFinalTest } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  logClinicalView: vi.fn(),
  episodeRecord: vi.fn(),
  patientRecord: vi.fn(),
  baselineVersionOfEpisode: vi.fn(),
  reassessmentOfEpisode: vi.fn(),
  finalTestOfEpisode: vi.fn(),
  finalTestReadings: vi.fn(),
  recordFinalTest: vi.fn(),
  staffTreatsNow: vi.fn(),
  frozenBaselineOfEpisode: vi.fn(),
  knowledgeObjective: vi.fn(),
  sessionReadings: vi.fn(),
  reassessmentOfSession: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaffViewing: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));
vi.mock('../settings/settings', () => ({ getSetting: vi.fn() }));
vi.mock('./readiness', () => ({
  readinessView: vi.fn().mockResolvedValue(undefined),
  worksReadiness: () => false,
}));

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
const pain: KnowledgeMeasure = {
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
};
const episode = (status = 'active') => ({ id: episodeId, patientId: 'patient-1', status });
const sign = (
  actor: StaffMember,
  entries: Record<string, unknown> = { [pain.key]: { value: 2 } },
) => signFinalTest({ db: {} as Db, actor }, { episodeId, entries });

// OUT-07 (user decisions 27 October 2026): any consultant retests exactly the baseline's measures
// once on the Review and discharge screen, each recorded or Not tested with a reason, and signs.
describe('final testing', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.episodeRecord.mockResolvedValue(episode());
    db.patientRecord.mockResolvedValue({ id: 'patient-1', name: 'Test Patient', opNumber: 'OP-1' });
    db.baselineVersionOfEpisode.mockResolvedValue('kb-1');
    db.frozenBaselineOfEpisode.mockResolvedValue([
      {
        key: pain.key,
        consultationId: null,
        notTestedReason: null,
        readings: [{ limb: null, value: 6, takenAt: new Date() }],
      },
    ]);
    db.knowledgeObjective.mockResolvedValue({ measures: [pain] });
    db.sessionReadings.mockResolvedValue([{ key: pain.key, limb: null, value: 4 }]);
    db.staffTreatsNow.mockResolvedValue(true);
  });

  it('lists the baseline with session 4, lets a consultant sign while treated, and logs the view', async () => {
    db.reassessmentOfEpisode.mockResolvedValue({
      sessionId: 'session-4',
      sessionNumber: 4,
      notTested: {},
    });
    const screen = await loadReview(consultant, episodeId);
    expect(screen?.items.map((item) => [item.baseline, item.session])).toEqual([['6/10', '4/10']]);
    expect(screen?.sessionNumber).toBe(4);
    expect(screen?.signs).toBe(true);
    expect(db.logClinicalView).toHaveBeenCalledWith(fakeTx, 'patient', 'patient-1');
    expect((await loadReview(physio, episodeId))?.signs, 'no Consultant tick').toBe(false);
    db.episodeRecord.mockResolvedValueOnce(episode('plan_proposed'));
    expect((await loadReview(consultant, episodeId))?.signs, 'not treated').toBe(false);
    db.baselineVersionOfEpisode.mockResolvedValueOnce(undefined);
    const none = await loadReview(consultant, episodeId);
    expect([none?.items, none?.signs], 'no baseline').toEqual([[], false]);
    await expect(
      loadReview({ ...consultant, role: 'front_desk', treatsPatients: false }, episodeId),
    ).rejects.toThrow(NotAllowedError);
  });

  it('shows the signed final testing as baseline, final and change', async () => {
    db.finalTestOfEpisode.mockResolvedValue({
      id: 'final-1',
      notTested: {},
      signedByName: consultant.name,
      signedAt: new Date(),
    });
    db.finalTestReadings.mockResolvedValue([{ key: pain.key, limb: null, value: 1 }]);
    const screen = await loadReview(consultant, episodeId);
    expect(screen?.signs).toBe(false);
    expect(screen?.sessionNumber).toBeNull();
    expect(screen?.finalTest?.rows.map((row) => [row.baseline, row.now, row.change])).toEqual([
      ['6/10', '1/10', '6/10 → 1/10'],
    ]);
  });

  it('signs each baseline measure as recorded or not tested', async () => {
    await expect(sign(consultant)).resolves.toEqual({ status: 'signed' });
    expect(db.recordFinalTest).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      kbVersionId: 'kb-1',
      by: consultant.id,
      readings: [{ key: pain.key, limb: null, value: 2, unit: '/10' }],
      notTested: {},
    });
    await expect(
      sign(consultant, { [pain.key]: { notTested: true, reason: ' Knee sore ' } }),
    ).resolves.toEqual({ status: 'signed' });
    expect(db.recordFinalTest).toHaveBeenLastCalledWith(
      fakeTx,
      expect.objectContaining({ readings: [], notTested: { [pain.key]: 'Knee sore' } }),
    );
  });

  it('refuses a physio, no tick, a gap, an untreated episode, no baseline, twice, and support', async () => {
    await expect(sign(physio)).rejects.toThrow(NotAllowedError);
    db.staffTreatsNow.mockResolvedValueOnce(false);
    await expect(sign(consultant)).rejects.toThrow('Signing needs the Treats patients tick.');
    await expect(sign(consultant, {})).rejects.toThrow(
      new ReviewError('Record Primary task pain (NRS 0-10), or mark it Not tested with a reason.'),
    );
    db.episodeRecord.mockResolvedValueOnce(episode('discharged'));
    await expect(sign(consultant)).rejects.toThrow(
      'Final testing is for an Active or Under review episode.',
    );
    db.baselineVersionOfEpisode.mockResolvedValueOnce(undefined);
    await expect(sign(consultant)).rejects.toThrow('This episode has no baseline to retest.');
    db.finalTestOfEpisode.mockResolvedValueOnce({ id: 'final-1' });
    await expect(sign(consultant)).rejects.toThrow('Final testing is signed already.');
    await expect(sign({ ...consultant, support: true })).rejects.toThrow(ReadOnlyError);
    expect(db.recordFinalTest).not.toHaveBeenCalled();
  });
});
