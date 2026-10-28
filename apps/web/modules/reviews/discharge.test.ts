import type { Db, EpisodeEntry, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { dischargeEpisode, dischargeView } from './discharge';
import { ReviewError } from './errors';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  episodePlanGoals: vi.fn(),
  episodeRecord: vi.fn(),
  staffTreatsNow: vi.fn(),
  updateEpisodeState: vi.fn(),
  visitsAhead: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

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
const physio: StaffMember = { ...consultant, consultant: false };
const episode = (status: EpisodeEntry['status'], pausedFrom: EpisodeEntry['pausedFrom'] = null) =>
  ({ id: episodeId, status, pausedFrom }) as EpisodeEntry;
const context = (actor: StaffMember) => ({ db: {} as Db, actor });
const ahead = [{ id: 'a1', number: 'HSR-0042', startsAt: new Date('2026-11-03T04:30:00Z') }];

// OUT-10 (user decisions 27 October 2026): a consultant with the Treats patients tick discharges
// any episode not yet discharged, with a reason from the list; recovered only after treatment;
// the visits booked ahead are listed (the database cancels them).
describe('discharge', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.episodeRecord.mockResolvedValue(episode('active'));
    db.staffTreatsNow.mockResolvedValue(true);
    db.updateEpisodeState.mockResolvedValue(true);
    db.visitsAhead.mockResolvedValue(ahead);
    db.episodePlanGoals.mockResolvedValue([]);
  });

  it('shows every reason, greying a recovered one before treatment, and the visits it cancels', async () => {
    const view = await dischargeView(fakeTx as never, consultant, episode('plan_proposed'));
    expect(view?.reasons.map((r) => [r.label, r.refusal !== undefined])).toEqual([
      ['Goals achieved', true],
      ['Independent management', true],
      ['Referred on', false],
      ['Patient choice', false],
      ['Financial or logistical barriers', false],
      ['Lost to follow-up', false],
      ['Other', false],
    ]);
    expect(view?.goals).toEqual([]);
    expect(view?.visitsAhead).toEqual([{ number: 'HSR-0042', startsAt: ahead[0]?.startsAt }]);
    expect(view?.discharges).toBe(true);
    expect((await dischargeView(fakeTx as never, physio, episode('active')))?.discharges).toBe(
      false,
    );
    expect(await dischargeView(fakeTx as never, consultant, episode('discharged'))).toBeUndefined();
  });

  it('discharges with the reason and note, from the status read', async () => {
    await expect(
      dischargeEpisode(context(consultant), {
        episodeId,
        reason: 'other',
        note: ' Moved to another city. ',
      }),
    ).resolves.toEqual({ status: 'discharged', cancelled: 1 });
    expect(db.updateEpisodeState).toHaveBeenCalledWith(
      fakeTx,
      episodeId,
      'active',
      { status: 'discharged', pausedFrom: null },
      { reason: 'other', note: 'Moved to another city.', goals: [] },
    );
  });

  // OUT-11: each goal of the plan marked, and what the report prints, passed on.
  it('marks each goal and passes on ongoing needs and recommendations', async () => {
    db.episodePlanGoals.mockResolvedValue(['Climb stairs without pain', 'Run 5 km']);
    await expect(
      dischargeEpisode(context(consultant), {
        episodeId,
        reason: 'goals_achieved',
        goals: ['achieved'],
      }),
    ).rejects.toThrow('Mark each goal Achieved, Partly achieved or Not achieved.');
    await dischargeEpisode(context(consultant), {
      episodeId,
      reason: 'goals_achieved',
      goals: ['achieved', 'partly_achieved'],
      ongoingNeeds: 'Keep the home programme twice a week.',
      recommendations: 'Check up in 3 months.',
      returnPlan: 'Fake return plan text',
      flarePlan: 'Fake flare plan text',
    });
    expect(db.updateEpisodeState).toHaveBeenCalledWith(
      fakeTx,
      episodeId,
      'active',
      { status: 'discharged', pausedFrom: null },
      {
        reason: 'goals_achieved',
        goals: [
          { text: 'Climb stairs without pain', outcome: 'achieved' },
          { text: 'Run 5 km', outcome: 'partly_achieved' },
        ],
        ongoingNeeds: 'Keep the home programme twice a week.',
        recommendations: 'Check up in 3 months.',
        returnPlan: 'Fake return plan text',
        flarePlan: 'Fake flare plan text',
      },
    );
  });

  it('refuses recovered before treatment, no reason, a physio, no tick, twice, and support', async () => {
    db.episodeRecord.mockResolvedValue(episode('plan_proposed'));
    await expect(
      dischargeEpisode(context(consultant), { episodeId, reason: 'goals_achieved' }),
    ).rejects.toThrow(
      new ReviewError(
        'Goals achieved needs treatment first: the episode was Plan proposed. Non attendance is never counted as recovered.',
      ),
    );
    await expect(dischargeEpisode(context(consultant), { episodeId })).rejects.toThrow(
      'Choose the discharge reason.',
    );
    await expect(
      dischargeEpisode(context(physio), { episodeId, reason: 'patient_choice' }),
    ).rejects.toThrow(NotAllowedError);
    db.staffTreatsNow.mockResolvedValueOnce(false);
    await expect(
      dischargeEpisode(context(consultant), { episodeId, reason: 'patient_choice' }),
    ).rejects.toThrow('Discharging needs the Treats patients tick.');
    db.episodeRecord.mockResolvedValue(episode('discharged'));
    await expect(
      dischargeEpisode(context(consultant), { episodeId, reason: 'patient_choice' }),
    ).rejects.toThrow(
      'The episode is discharged; a new problem or a recurrence opens a new episode.',
    );
    await expect(
      dischargeEpisode(context({ ...consultant, support: true }), {
        episodeId,
        reason: 'patient_choice',
      }),
    ).rejects.toThrow(ReadOnlyError);
    expect(db.updateEpisodeState).not.toHaveBeenCalled();
  });
});
