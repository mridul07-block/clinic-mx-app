import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import type { ServiceTransaction } from '../access/service';
import { EpisodeError, changeEpisodeStatus, linkRecurrence, openEpisode } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  episodeRecord: vi.fn(),
  insertEpisode: vi.fn(),
  patientRecord: vi.fn(),
  setEpisodeLink: vi.fn(),
  updateEpisodeState: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const patientId = '00000000-0000-4000-8000-000000000301';
const episodeId = '00000000-0000-4000-8000-000000000501';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000203',
  email: 'frontdesk@clinicmx.test',
  name: 'Test Front Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const context = (actor = member()) => ({ db: {} as Db, actor });
const tx = fakeTx as unknown as ServiceTransaction;
const episode = (status: string, pausedFrom: string | null = null) => ({
  id: episodeId,
  patientId,
  status,
  pausedFrom,
});

// SCH-03: episodes open at booking and move only through the machine's events.
describe('episodes', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.patientRecord.mockResolvedValue({ id: patientId });
    db.insertEpisode.mockResolvedValue(episodeId);
    db.updateEpisodeState.mockResolvedValue(true);
  });

  it('opens an episode at a centre the person works in, for those who book', async () => {
    expect(await openEpisode(context(), { patientId, centreId: hsr, bodyRegion: 'knee' })).toBe(
      episodeId,
    );
    expect(db.insertEpisode).toHaveBeenCalledWith(fakeTx, {
      patientId,
      centreId: hsr,
      bodyRegion: 'knee',
    });
    await expect(openEpisode(context(), { patientId, centreId: koramangala })).rejects.toThrow(
      NotAllowedError,
    );
    for (const role of ['physiotherapist', 'finance'] as const) {
      await expect(
        openEpisode(context(member({ role })), { patientId, centreId: hsr }),
      ).rejects.toThrow(NotAllowedError);
    }
    await expect(
      openEpisode(context(member({ role: 'super_admin', support: true })), {
        patientId,
        centreId: hsr,
      }),
    ).rejects.toThrow(ReadOnlyError);
  });

  it('links a recurrence only to a discharged episode of the same patient', async () => {
    db.episodeRecord.mockResolvedValueOnce(episode('active'));
    await expect(
      openEpisode(context(), { patientId, centreId: hsr, linkedEpisodeId: episodeId }),
    ).rejects.toThrow(EpisodeError);
    db.episodeRecord.mockResolvedValueOnce(episode('discharged'));
    await expect(
      openEpisode(context(), { patientId, centreId: hsr, linkedEpisodeId: episodeId }),
    ).resolves.toBe(episodeId);
  });

  it('moves an episode by an event, from the status it was read in', async () => {
    db.episodeRecord.mockResolvedValue(episode('plan_proposed'));
    expect(await changeEpisodeStatus(tx, episodeId, 'activate')).toEqual({
      status: 'active',
      pausedFrom: null,
    });
    expect(db.updateEpisodeState).toHaveBeenCalledWith(
      fakeTx,
      episodeId,
      'plan_proposed',
      { status: 'active', pausedFrom: null },
      undefined,
    );
  });

  it('refuses an event the machine does not allow, without writing', async () => {
    db.episodeRecord.mockResolvedValue(episode('intake_pending'));
    await expect(changeEpisodeStatus(tx, episodeId, 'activate')).rejects.toThrow(
      'An episode that is Intake pending cannot become active.',
    );
    await expect(
      changeEpisodeStatus(tx, episodeId, 'discharge', { reason: 'goals_achieved' }),
    ).rejects.toThrow('Non attendance is never counted as recovered');
    expect(db.updateEpisodeState).not.toHaveBeenCalled();
  });

  it('says so when the episode changed meanwhile, or is missing', async () => {
    db.episodeRecord.mockResolvedValueOnce(episode('active'));
    db.updateEpisodeState.mockResolvedValueOnce(false);
    await expect(changeEpisodeStatus(tx, episodeId, 'start_review')).rejects.toThrow(
      'The episode changed meanwhile.',
    );
    db.episodeRecord.mockResolvedValueOnce(undefined);
    await expect(changeEpisodeStatus(tx, episodeId, 'hold')).rejects.toThrow(
      'That episode was not found.',
    );
  });
});

// SCH-14: the consultant marks an episode a recurrence of an earlier, discharged one (PRD J7.5).
describe('recurrences', () => {
  const earlierId = '00000000-0000-4000-8000-000000000502';
  const consultant = member({
    role: 'physiotherapist',
    treatsPatients: true,
    consultant: true,
  });
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.setEpisodeLink.mockResolvedValue(true);
  });
  const records = (current: object, earlier: object) => {
    db.episodeRecord.mockImplementation((_tx: unknown, id: string) =>
      Promise.resolve(id === episodeId ? current : id === earlierId ? earlier : undefined),
    );
  };

  it('links the open episode to the same patient’s discharged one, and removes the link', async () => {
    records(episode('awaiting_consultation'), { ...episode('discharged'), id: earlierId });
    await expect(
      linkRecurrence(context(consultant), { episodeId, linkedEpisodeId: earlierId }),
    ).resolves.toEqual({ linkedEpisodeId: earlierId });
    expect(db.setEpisodeLink).toHaveBeenCalledWith(fakeTx, episodeId, earlierId);
    await linkRecurrence(context(consultant), { episodeId, linkedEpisodeId: null });
    expect(db.setEpisodeLink).toHaveBeenLastCalledWith(fakeTx, episodeId, null);
  });

  it('refuses another patient’s episode, one still open, a discharged current one, and non-consultants', async () => {
    records(episode('active'), {
      ...episode('discharged'),
      id: earlierId,
      patientId: 'someone-else',
    });
    await expect(
      linkRecurrence(context(consultant), { episodeId, linkedEpisodeId: earlierId }),
    ).rejects.toThrow(EpisodeError);
    records(episode('active'), { ...episode('active'), id: earlierId });
    await expect(
      linkRecurrence(context(consultant), { episodeId, linkedEpisodeId: earlierId }),
    ).rejects.toThrow('A recurrence links to a discharged episode of the same patient.');
    records(episode('discharged'), { ...episode('discharged'), id: earlierId });
    await expect(
      linkRecurrence(context(consultant), { episodeId, linkedEpisodeId: earlierId }),
    ).rejects.toThrow('A discharged episode never changes.');
    await expect(
      linkRecurrence(context(member({ role: 'physiotherapist', treatsPatients: true })), {
        episodeId,
        linkedEpisodeId: earlierId,
      }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      linkRecurrence(context(member()), { episodeId, linkedEpisodeId: earlierId }),
    ).rejects.toThrow(NotAllowedError);
    expect(db.setEpisodeLink).not.toHaveBeenCalled();
  });
});
