import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { showMyPlan, tickMyPlanExercise } from './my-plan';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  episodeRecord: vi.fn(),
  episodeHasPlan: vi.fn(),
  liveMyPlanLink: vi.fn(),
  myPlanView: vi.fn(),
  withPatientAccess: vi.fn(),
  exerciseTickSubject: vi.fn(),
  tickExercise: vi.fn(),
  untickExercise: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const services = vi.hoisted(() => ({
  PatientLinkError: class PatientLinkError extends Error {},
  issuePatientLink: vi.fn(),
  patientLinkPath: vi.fn(),
  verifyPatientLink: vi.fn(),
}));
vi.mock('./services', () => services);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const episodeId = '00000000-0000-4000-8000-000000000e01';
const patientId = '00000000-0000-4000-8000-000000000501';
const desk = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000203',
  email: 'desk@clinicmx.test',
  name: 'Test Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const context = (actor = desk()) => ({ db: {} as Db, actor });
const expiresAt = new Date('2026-11-27T00:00:00Z');

// PAT-01: the desk shows the episode's working My plan link as a QR, or issues one; never for a
// discharged episode or one without a plan, nor at another centre or for a physio.
describe('Show My plan QR', () => {
  beforeEach(() => {
    for (const fn of [
      ...Object.values(db),
      services.issuePatientLink,
      services.patientLinkPath,
      services.verifyPatientLink,
    ]) {
      fn.mockReset();
    }
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.episodeRecord.mockResolvedValue({
      id: episodeId,
      patientId,
      centreId: hsr,
      status: 'active',
    });
    db.episodeHasPlan.mockResolvedValue(true);
  });

  it('shows the working link again, signed from its row', async () => {
    db.liveMyPlanLink.mockResolvedValue({ id: 'link', expiresAt });
    services.patientLinkPath.mockReturnValue('/p/token');
    expect(await showMyPlan(context(), { episodeId })).toEqual({
      linkId: 'link',
      path: '/p/token',
      expiresAt,
    });
    expect(services.issuePatientLink).not.toHaveBeenCalled();
  });

  it('issues a My plan link for the episode when there is none', async () => {
    db.liveMyPlanLink.mockResolvedValue(undefined);
    services.issuePatientLink.mockResolvedValue({ linkId: 'new', path: '/p/new', expiresAt });
    expect((await showMyPlan(context(), { episodeId })).path).toBe('/p/new');
    expect(services.issuePatientLink).toHaveBeenCalledWith(fakeTx, {
      patientId,
      episodeId,
      purpose: 'my_plan',
    });
  });

  it('refuses a discharged episode, one without a plan, another centre and a physio', async () => {
    db.episodeRecord.mockResolvedValue({
      id: episodeId,
      patientId,
      centreId: hsr,
      status: 'discharged',
    });
    await expect(showMyPlan(context(), { episodeId })).rejects.toThrow(/discharged/);
    db.episodeRecord.mockResolvedValue({
      id: episodeId,
      patientId,
      centreId: hsr,
      status: 'active',
    });
    db.episodeHasPlan.mockResolvedValue(false);
    await expect(showMyPlan(context(), { episodeId })).rejects.toThrow(/plan is signed/);
    db.episodeHasPlan.mockResolvedValue(true);
    await expect(
      showMyPlan(context(desk({ centreIds: ['00000000-0000-4000-8000-000000000102'] })), {
        episodeId,
      }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      showMyPlan(context(desk({ role: 'physiotherapist', treatsPatients: true })), { episodeId }),
    ).rejects.toThrow(NotAllowedError);
    expect(services.issuePatientLink).not.toHaveBeenCalled();
  });
});

// PAT-02: a tick or untick for today on the newest plan, as the row reads now; "changed" when the
// plan changed under the page; "link" when the link no longer opens My plan.
describe('Ticking an exercise', () => {
  const link = { id: 'link', patientId, purpose: 'my_plan' as const };
  const subject = {
    patientId,
    episodeId,
    planOfCareId: 'plan',
    homeProgramme: [{ exercise: 'Step downs', dose: '3 x 10', note: '' }],
    today: '2026-10-28',
  };
  beforeEach(() => {
    db.withPatientAccess.mockImplementation(
      (_db: unknown, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    services.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.exerciseTickSubject.mockResolvedValue(subject);
  });

  it('ticks and unticks today’s row', async () => {
    expect(
      await tickMyPlanExercise('token', { index: '0', exercise: 'Step downs', done: 'yes' }),
    ).toBe('done');
    expect(db.tickExercise).toHaveBeenCalledWith(fakeTx, {
      linkId: 'link',
      subject,
      index: 0,
      exercise: 'Step downs',
    });
    expect(
      await tickMyPlanExercise('token', { index: '0', exercise: 'Step downs', done: 'no' }),
    ).toBe('done');
    expect(db.untickExercise).toHaveBeenCalledWith(fakeTx, { subject, index: 0 });
  });

  it('says the plan changed for another row or wording, and refuses other links', async () => {
    expect(await tickMyPlanExercise('token', { index: '0', exercise: 'Squats', done: 'yes' })).toBe(
      'changed',
    );
    expect(
      await tickMyPlanExercise('token', { index: '3', exercise: 'Step downs', done: 'yes' }),
    ).toBe('changed');
    expect(await tickMyPlanExercise('token', { index: 'x', exercise: '', done: 'maybe' })).toBe(
      'changed',
    );
    services.verifyPatientLink.mockResolvedValue({ status: 'revoked', purpose: 'my_plan' });
    expect(
      await tickMyPlanExercise('token', { index: '0', exercise: 'Step downs', done: 'yes' }),
    ).toBe('link');
    services.verifyPatientLink.mockResolvedValue({
      status: 'valid',
      link: { ...link, purpose: 'feedback' },
    });
    expect(
      await tickMyPlanExercise('token', { index: '0', exercise: 'Step downs', done: 'yes' }),
    ).toBe('link');
    expect(db.tickExercise).not.toHaveBeenCalled();
    expect(db.untickExercise).not.toHaveBeenCalled();
  });
});
