import type { Db, StaffMember, StaffRecord } from '@clinic-mx/db';
import type { StaffRole } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import {
  StaffActionError,
  createInviteLink,
  inviteStaff,
  resetStaffTwoStep,
  setStaffActive,
  updateStaff,
} from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  endStaffSessions: vi.fn(),
  insertStaffMember: vi.fn(),
  linkStaffLogin: vi.fn(),
  recordAccessEvent: vi.fn(),
  setStaffMemberActive: vi.fn(),
  staffEmailTaken: vi.fn(),
  staffRecord: vi.fn(),
  updateStaffMember: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const auth = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  generateLink: vi.fn(),
  listFactors: vi.fn(),
  deleteFactor: vi.fn(),
}));
vi.mock('../../lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    auth: {
      admin: {
        inviteUserByEmail: auth.inviteUserByEmail,
        generateLink: auth.generateLink,
        mfa: { listFactors: auth.listFactors, deleteFactor: auth.deleteFactor },
      },
    },
  }),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const adminId = '00000000-0000-4000-8000-000000000201';
const targetId = '00000000-0000-4000-8000-000000000204';

const member = (role: StaffRole, id = adminId): StaffMember => ({
  id,
  email: `${role}@clinicmx.test`,
  name: 'Test person',
  role,
  treatsPatients: false,
  consultant: false,
  centreIds: role === 'super_admin' ? [] : [hsr],
  support: false,
});
const superAdmin = member('super_admin');
const context = (actor = superAdmin) => ({ db: {} as Db, actor });

const record = (values: Partial<StaffRecord> = {}): StaffRecord => ({
  id: targetId,
  name: 'Test Desk',
  email: 'new.desk@clinicmx.test',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  credentials: null,
  active: true,
  accessEndsAt: null,
  authUserId: 'auth-new',
  velyxSupport: false,
  centreIds: [hsr],
  consultationPriceItemId: null,
  ...values,
});

const details = {
  name: 'Test Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
};

// IAM-06: staff management services, each a staffService for staff.manage.
describe('staff management', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), ...Object.values(auth)]) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.staffEmailTaken.mockResolvedValue(false);
    db.insertStaffMember.mockResolvedValue(targetId);
    db.staffRecord.mockResolvedValue(record());
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'auth-new' } }, error: null });
    auth.generateLink.mockResolvedValue({
      data: { user: { id: 'auth-new' }, properties: { hashed_token: 'hash-1' } },
      error: null,
    });
  });

  it('invites: adds the staff member, sends the email, links the login, records it', async () => {
    expect(await inviteStaff(context(), { email: ' New.Desk@ClinicMx.test ', details })).toEqual({
      staffUserId: targetId,
      emailSent: true,
      tokenHash: undefined,
    });
    expect(db.insertStaffMember).toHaveBeenCalledWith(fakeTx, {
      email: 'new.desk@clinicmx.test',
      details: { ...details, accessEndsOn: undefined },
    });
    expect(auth.inviteUserByEmail).toHaveBeenCalledWith('new.desk@clinicmx.test');
    expect(db.linkStaffLogin).toHaveBeenCalledWith(fakeTx, targetId, 'auth-new');
    expect(db.recordAccessEvent).toHaveBeenCalledWith(fakeTx, {
      action: 'staff_invited',
      staffUserId: targetId,
    });
  });

  it('gives an invite link when the email cannot be sent, and still adds them', async () => {
    auth.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { status: 500, code: 'unexpected_failure', message: 'Error sending invite email' },
    });
    expect(await inviteStaff(context(), { email: 'new.desk@clinicmx.test', details })).toEqual({
      staffUserId: targetId,
      emailSent: false,
      tokenHash: 'hash-1',
    });
    expect(auth.generateLink).toHaveBeenCalledWith({
      type: 'invite',
      email: 'new.desk@clinicmx.test',
    });
    expect(db.linkStaffLogin).toHaveBeenCalledWith(fakeTx, targetId, 'auth-new');
  });

  it('refuses an email a staff member already has, before adding anyone', async () => {
    db.staffEmailTaken.mockResolvedValue(true);
    await expect(
      inviteStaff(context(), { email: 'desk.hsr@clinicmx.test', details }),
    ).rejects.toThrow('A staff member with this email already exists.');
    expect(db.insertStaffMember).not.toHaveBeenCalled();
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('is refused to every role but the Super Admin, before anything is read or sent', async () => {
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist', 'finance'] as const) {
      const actor = member(role);
      await expect(
        inviteStaff(context(actor), { email: 'x@clinicmx.test', details }),
      ).rejects.toThrow(NotAllowedError);
      await expect(updateStaff(context(actor), { staffUserId: targetId, details })).rejects.toThrow(
        NotAllowedError,
      );
      await expect(
        setStaffActive(context(actor), { staffUserId: targetId, active: false }),
      ).rejects.toThrow(NotAllowedError);
      await expect(resetStaffTwoStep(context(actor), { staffUserId: targetId })).rejects.toThrow(
        NotAllowedError,
      );
    }
    expect(db.withStaffAccess).not.toHaveBeenCalled();
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.listFactors).not.toHaveBeenCalled();
  });

  it('is refused to a Velyx support login, read only, though it is a Super Admin (IAM-08)', async () => {
    const support = { ...superAdmin, id: '00000000-0000-4000-8000-000000000212', support: true };
    await expect(
      inviteStaff(context(support), { email: 'x@clinicmx.test', details }),
    ).rejects.toThrow(ReadOnlyError);
    await expect(
      setStaffActive(context(support), { staffUserId: targetId, active: false }),
    ).rejects.toThrow('Velyx support access is read only.');
    expect(db.withStaffAccess).not.toHaveBeenCalled();
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('keeps a Velyx support login a Super Admin without ticks (IAM-08)', async () => {
    db.staffRecord.mockResolvedValue(
      record({ role: 'super_admin', velyxSupport: true, centreIds: [] }),
    );
    await expect(
      updateStaff(context(), { staffUserId: targetId, details: { ...details, name: 'Renamed' } }),
    ).rejects.toThrow(
      new StaffActionError('Velyx support logins keep the Super Admin role and no ticks.'),
    );
    expect(db.updateStaffMember).not.toHaveBeenCalled();
  });

  it('changes role, ticks, centres and end date', async () => {
    await updateStaff(context(), {
      staffUserId: targetId,
      details: { ...details, role: 'physiotherapist', accessEndsOn: '2026-11-30' },
    });
    expect(db.updateStaffMember).toHaveBeenCalledWith(fakeTx, targetId, {
      ...details,
      role: 'physiotherapist',
      treatsPatients: true,
      accessEndsOn: '2026-11-30',
    });
  });

  it('keeps the Super Admin from changing their own role or deactivating themselves', async () => {
    db.staffRecord.mockResolvedValue(record({ id: adminId, role: 'super_admin', centreIds: [] }));
    await expect(
      updateStaff(context(), {
        staffUserId: adminId,
        details: { ...details, role: 'finance', centreIds: [] },
      }),
    ).rejects.toThrow(new StaffActionError('You cannot change your own role.'));
    await expect(
      setStaffActive(context(), { staffUserId: adminId, active: false }),
    ).rejects.toThrow(new StaffActionError('You cannot deactivate yourself.'));
    expect(db.updateStaffMember).not.toHaveBeenCalled();
    expect(db.setStaffMemberActive).not.toHaveBeenCalled();
  });

  it('deactivates (ending their sessions) and reactivates, never deletes', async () => {
    await setStaffActive(context(), { staffUserId: targetId, active: false });
    await setStaffActive(context(), { staffUserId: targetId, active: true });
    expect(db.setStaffMemberActive.mock.calls).toEqual([
      [fakeTx, targetId, false],
      [fakeTx, targetId, true],
    ]);
    // IAM-07: deactivating ends their sessions at once; reactivating does not need to.
    expect(db.endStaffSessions.mock.calls).toEqual([[fakeTx, targetId]]);
  });

  it('makes an invite link, and says so once the invite is accepted', async () => {
    expect(await createInviteLink(context(), { staffUserId: targetId })).toEqual({
      tokenHash: 'hash-1',
    });
    expect(db.recordAccessEvent).toHaveBeenCalledWith(fakeTx, {
      action: 'invite_link_created',
      staffUserId: targetId,
    });
    auth.generateLink.mockResolvedValue({
      data: { user: null, properties: null },
      error: { status: 422, code: 'email_exists', message: 'already registered' },
    });
    await expect(createInviteLink(context(), { staffUserId: targetId })).rejects.toThrow(
      'They have already accepted their invite.',
    );
  });

  it('resets two step verification by removing every authenticator app', async () => {
    auth.listFactors.mockResolvedValue({
      data: { factors: [{ id: 'f1' }, { id: 'f2' }] },
      error: null,
    });
    auth.deleteFactor.mockResolvedValue({ data: {}, error: null });
    expect(await resetStaffTwoStep(context(), { staffUserId: targetId })).toEqual({ removed: 2 });
    expect(auth.deleteFactor.mock.calls).toEqual([
      [{ userId: 'auth-new', id: 'f1' }],
      [{ userId: 'auth-new', id: 'f2' }],
    ]);
    expect(db.recordAccessEvent).toHaveBeenCalledWith(fakeTx, {
      action: 'two_step_reset',
      staffUserId: targetId,
    });
  });

  it('refuses a staff member who is not found', async () => {
    db.staffRecord.mockResolvedValue(undefined);
    await expect(
      setStaffActive(context(), { staffUserId: targetId, active: false }),
    ).rejects.toThrow('That staff member was not found.');
  });
});
