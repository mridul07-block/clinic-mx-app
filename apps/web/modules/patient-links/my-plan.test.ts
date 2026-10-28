import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { showMyPlan } from './my-plan';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  episodeRecord: vi.fn(),
  episodeHasPlan: vi.fn(),
  liveMyPlanLink: vi.fn(),
  myPlanView: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const services = vi.hoisted(() => ({
  PatientLinkError: class PatientLinkError extends Error {},
  issuePatientLink: vi.fn(),
  patientLinkPath: vi.fn(),
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
    for (const fn of [...Object.values(db), services.issuePatientLink, services.patientLinkPath]) {
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
