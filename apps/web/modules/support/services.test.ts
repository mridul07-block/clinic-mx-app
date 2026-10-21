import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import {
  SupportActionError,
  addSupportLogin,
  endSupportAccess,
  grantSupportAccess,
} from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  activeGrant: vi.fn(),
  endSupportGrant: vi.fn(),
  endSupportSessions: vi.fn(),
  insertStaffMember: vi.fn(),
  insertSupportGrant: vi.fn(),
  linkStaffLogin: vi.fn(),
  recordAccessEvent: vi.fn(),
  staffEmailTaken: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../settings/settings', () => ({ getSetting: () => Promise.resolve(24) }));
const staffServices = vi.hoisted(() => ({ sendInvite: vi.fn() }));
vi.mock('../staff/services', () => staffServices);

const adminId = '00000000-0000-4000-8000-000000000201';
const grantId = '00000000-0000-4000-8000-000000000901';
const supportId = '00000000-0000-4000-8000-000000000212';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: adminId,
  email: 'admin@clinicmx.test',
  name: 'Test Super Admin',
  role: 'super_admin',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
  ...extra,
});
const context = (actor = member()) => ({ db: {} as Db, actor });
const endsAt = new Date('2026-10-22T10:00:00Z');

// IAM-08 done when: time limited grant by Super Admin; every action under it logged.
describe('support access', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), staffServices.sendInvite]) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.insertSupportGrant.mockResolvedValue({ id: grantId, endsAt });
    db.endSupportGrant.mockResolvedValue(true);
    db.endSupportSessions.mockResolvedValue(2);
    db.staffEmailTaken.mockResolvedValue(false);
    db.insertStaffMember.mockResolvedValue(supportId);
    staffServices.sendInvite.mockResolvedValue({ authUserId: 'auth-support', emailSent: true });
  });

  it('grants from now for the hours given, with the reason, as the Super Admin', async () => {
    expect(
      await grantSupportAccess(context(), { hours: '2', reason: ' Check a report bug ' }),
    ).toEqual({ id: grantId, endsAt });
    expect(db.insertSupportGrant).toHaveBeenCalledWith(fakeTx, {
      grantedBy: adminId,
      hours: 2,
      reason: 'Check a report bug',
    });
  });

  it('refuses more hours than the setting, and no reason, before writing', async () => {
    await expect(grantSupportAccess(context(), { hours: '25', reason: 'x' })).rejects.toThrow(
      z.ZodError,
    );
    await expect(grantSupportAccess(context(), { hours: '1', reason: '' })).rejects.toThrow(
      z.ZodError,
    );
    expect(db.withStaffAccess).not.toHaveBeenCalled();
  });

  it('refuses a second grant while one is on', async () => {
    db.activeGrant.mockResolvedValue({ id: grantId, endsAt });
    await expect(grantSupportAccess(context(), { hours: 1, reason: 'x' })).rejects.toThrow(
      new SupportActionError(
        'Support access is already on until 22 Oct 2026, 15:30 IST. End it before granting it again.',
      ),
    );
    expect(db.insertSupportGrant).not.toHaveBeenCalled();
  });

  it('ends access early and every support login’s sessions with it', async () => {
    expect(await endSupportAccess(context(), { grantId })).toEqual({ sessionsEnded: 2 });
    expect(db.endSupportGrant).toHaveBeenCalledWith(fakeTx, grantId);
    expect(db.endSupportSessions).toHaveBeenCalledWith(fakeTx);
  });

  it('says so when the access had already ended', async () => {
    db.endSupportGrant.mockResolvedValue(false);
    await expect(endSupportAccess(context(), { grantId })).rejects.toThrow(
      new SupportActionError('That support access had already ended.'),
    );
    expect(db.endSupportSessions).not.toHaveBeenCalled();
  });

  it('adds a support login: a Super Admin without ticks, marked support, invited', async () => {
    expect(
      await addSupportLogin(context(), { email: ' Help@Velyx.test ', name: 'Velyx Help' }),
    ).toEqual({ staffUserId: supportId, emailSent: true, tokenHash: undefined });
    expect(db.insertStaffMember).toHaveBeenCalledWith(fakeTx, {
      email: 'help@velyx.test',
      details: {
        name: 'Velyx Help',
        role: 'super_admin',
        treatsPatients: false,
        consultant: false,
        centreIds: [],
      },
      velyxSupport: true,
    });
    expect(db.linkStaffLogin).toHaveBeenCalledWith(fakeTx, supportId, 'auth-support');
    expect(db.recordAccessEvent).toHaveBeenCalledWith(fakeTx, {
      action: 'staff_invited',
      staffUserId: supportId,
    });
  });

  it('is refused to every other role, and to a support login, before anything is written', async () => {
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist', 'finance'] as const) {
      await expect(
        grantSupportAccess(context(member({ role })), { hours: 1, reason: 'x' }),
      ).rejects.toThrow(NotAllowedError);
      await expect(endSupportAccess(context(member({ role })), { grantId })).rejects.toThrow(
        NotAllowedError,
      );
    }
    const support = member({ id: supportId, support: true });
    await expect(grantSupportAccess(context(support), { hours: 1, reason: 'x' })).rejects.toThrow(
      ReadOnlyError,
    );
    await expect(endSupportAccess(context(support), { grantId })).rejects.toThrow(ReadOnlyError);
    await expect(
      addSupportLogin(context(support), { email: 'x@velyx.test', name: 'X' }),
    ).rejects.toThrow(ReadOnlyError);
    expect(db.withStaffAccess).not.toHaveBeenCalled();
  });
});
