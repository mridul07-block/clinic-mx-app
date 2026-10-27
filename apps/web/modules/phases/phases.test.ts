import type { Db, StaffMember } from '@clinic-mx/db';
import type { PhaseCriterion, ProgrammePhase } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import {
  episodePhaseLine,
  markPhaseCriterion,
  overridePhase,
  PhaseError,
  phasesView,
  progressPhase,
} from './phases';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  addPhaseMark: vi.fn(),
  addPhaseMove: vi.fn(),
  episodePhaseRecords: vi.fn(),
  episodeRecord: vi.fn(),
  episodeTreatingPhysio: vi.fn(),
  latestPhaseVersion: vi.fn(),
  regionProgramme: vi.fn(),
  staffTreatsNow: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const baseline = vi.hoisted(() => ({ episodeRegion: vi.fn() }));
vi.mock('../sessions/baseline', () => baseline);
vi.mock('../settings/settings', () => ({ getSetting: vi.fn().mockResolvedValue(5) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const episodeId = '00000000-0000-4000-8000-000000000501';
const physio: StaffMember = {
  id: '00000000-0000-4000-8000-000000000208',
  email: 'physio@clinicmx.test',
  name: 'Test Physio',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: false,
  centreIds: [hsr],
  support: false,
};
const consultant: StaffMember = {
  ...physio,
  id: '00000000-0000-4000-8000-000000000207',
  name: 'Dr Test Consultant',
  consultant: true,
};
const phase = (number: number, name: string): ProgrammePhase => ({
  region: 'knee',
  number,
  name,
  timing: '',
  goal: '',
  content: '',
  markers: '',
});
const line = (phaseNumber: number, position: number): PhaseCriterion => ({
  key: `knee.phase${String(phaseNumber)}.line_${String(position)}`,
  region: 'knee',
  phase: phaseNumber,
  position,
  text: `Phase ${String(phaseNumber)} line ${String(position)}`,
  namesPainLimit: false,
});
const first = line(0, 0);
const second = line(0, 1);
const context = (actor: StaffMember) => ({ db: {} as Db, actor });
const met = (key: string) => ({ criterionKey: key, result: 'met', markedAt: new Date() });

// OUT-04 (user decisions 27 October 2026): the treating physio marks and moves on once every exit
// line is Met; a consultant with the Treats patients tick overrides with a reason.
describe('the phase stepper', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    baseline.episodeRegion.mockResolvedValue('knee');
    db.episodeRecord.mockResolvedValue({ id: episodeId, status: 'active' });
    db.episodePhaseRecords.mockResolvedValue({ programme: undefined, marks: [], moves: [] });
    db.latestPhaseVersion.mockResolvedValue('kb-3');
    db.regionProgramme.mockResolvedValue({
      phases: [phase(0, 'Screen & Protect'), phase(1, 'Restore & Activate')],
      criteria: [first, second, line(1, 0)],
    });
    db.episodeTreatingPhysio.mockResolvedValue(physio.id);
    db.staffTreatsNow.mockResolvedValue(true);
  });

  it('shows the treating physio the marks and why moving on waits; a consultant the override', async () => {
    const episode = { id: episodeId, status: 'active' as const };
    const own = await phasesView(fakeTx as never, physio, episode, { value: 3, session: 4 });
    expect(own).toMatchObject({
      missing: null,
      marks: true,
      overrides: false,
      refusal: 'Mark every exit criterion of this phase Met first.',
    });
    expect(own.stepper?.phases[1]?.lockedBecause).toEqual([
      'Phase 0: Phase 0 line 0',
      'Phase 0: Phase 0 line 1',
    ]);
    expect(own.painHint).toContain('Latest pain during activity: 3/10 at session 4.');
    const lead = await phasesView(fakeTx as never, consultant, episode, null);
    expect(lead).toMatchObject({ marks: false, overrides: true, refusal: null });
    expect(await episodePhaseLine(fakeTx as never, episodeId)).toBe(
      'Phase 0 of 1: Screen & Protect',
    );
  });

  it('says why there is no stepper: no region yet, or a workbook without phases', async () => {
    const episode = { id: episodeId, status: 'active' as const };
    baseline.episodeRegion.mockResolvedValueOnce('');
    expect((await phasesView(fakeTx as never, physio, episode, null)).missing).toBe(
      'The phases start once the consultation names the region.',
    );
    baseline.episodeRegion.mockResolvedValue('bone_stress');
    db.latestPhaseVersion.mockResolvedValue(undefined);
    expect((await phasesView(fakeTx as never, physio, episode, null)).missing).toBe(
      'This workbook has no phased programme.',
    );
    expect(await episodePhaseLine(fakeTx as never, episodeId)).toBe(
      'Phase: this workbook has no phased programme',
    );
  });

  it('marks and moves on for the treating physio only, once every line is Met', async () => {
    const mark = (actor: StaffMember, criterionKey = first.key) =>
      markPhaseCriterion(context(actor), { episodeId, criterionKey, result: 'met' });
    await expect(mark(physio)).resolves.toEqual({ status: 'marked' });
    expect(db.addPhaseMark).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      kbVersionId: 'kb-3',
      criterionKey: first.key,
      result: 'met',
      by: physio.id,
    });
    await expect(mark(physio, 'knee.phase1.line_0')).rejects.toThrow(
      'That is not an exit criterion of the current phase.',
    );
    db.episodeTreatingPhysio.mockResolvedValueOnce(consultant.id);
    await expect(mark(physio)).rejects.toThrow(
      new PhaseError('Only the treating physio does this.'),
    );

    const progress = (toPhase = 1) => progressPhase(context(physio), { episodeId, toPhase });
    await expect(progress()).rejects.toThrow('Mark every exit criterion of this phase Met first.');
    db.episodePhaseRecords.mockResolvedValue({
      programme: undefined,
      marks: [met(first.key), met(second.key)],
      moves: [],
    });
    await expect(progress(2)).rejects.toThrow('The phase has changed. Reload the page.');
    await expect(progress()).resolves.toEqual({ status: 'moved' });
    expect(db.addPhaseMove).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      kbVersionId: 'kb-3',
      region: 'knee',
      fromPhase: 0,
      toPhase: 1,
      kind: 'progress',
      reason: null,
      by: physio.id,
    });
  });

  it('overrides for a consultant with the tick and a reason, to another phase only', async () => {
    const override = (actor: StaffMember, toPhase: number, reason = 'Arrived settled.') =>
      overridePhase(context(actor), { episodeId, toPhase, reason });
    await expect(override(physio, 1)).rejects.toThrow(NotAllowedError);
    await expect(override(consultant, 1, ' ')).rejects.toThrow('Say why the phase is moved.');
    await expect(override(consultant, 0)).rejects.toThrow('The patient is in Phase 0 already.');
    await expect(override(consultant, 4)).rejects.toThrow('That phase is not in the programme.');
    db.staffTreatsNow.mockResolvedValueOnce(false);
    await expect(override(consultant, 1)).rejects.toThrow(
      'A phase override needs the Treats patients tick.',
    );
    db.episodeRecord.mockResolvedValueOnce({ id: episodeId, status: 'plan_proposed' });
    await expect(override(consultant, 1)).rejects.toThrow(
      'The phase moves only while the episode is Active or Under review.',
    );
    await expect(override(consultant, 1)).resolves.toEqual({ status: 'moved' });
    expect(db.addPhaseMove).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ kind: 'override', reason: 'Arrived settled.', toPhase: 1 }),
    );
  });
});
