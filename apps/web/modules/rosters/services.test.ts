import type { Db, StaffMember } from '@clinic-mx/db';
import { addDays, istDate } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import {
  RosterError,
  cancelLeaveService,
  decideLeaveService,
  recordLeave,
  requestLeave,
  saveRosterService,
} from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  assignedToCentre: vi.fn(),
  cancelLeave: vi.fn(),
  decideLeave: vi.fn(),
  insertLeave: vi.fn(),
  leaveRecord: vi.fn(),
  rosterVersions: vi.fn(),
  saveRoster: vi.fn(),
  staffRecord: vi.fn(),
  versionsFrom: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
// Test value only; the real one is the `scheduling.slot_minutes` row.
vi.mock('../settings/settings', () => ({ getSetting: vi.fn(() => Promise.resolve(15)) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const managerId = '00000000-0000-4000-8000-000000000203';
const physioId = '00000000-0000-4000-8000-000000000207';
const leaveId = '00000000-0000-4000-8000-000000000701';
const today = istDate(new Date());
const tomorrow = addDays(today, 1);
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: managerId,
  email: 'manager@clinicmx.test',
  name: 'Test Centre Manager',
  role: 'centre_manager',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr, koramangala],
  support: false,
  ...extra,
});
const physio = member({
  id: physioId,
  role: 'physiotherapist',
  treatsPatients: true,
  centreIds: [hsr],
});
const context = (actor = member()) => ({ db: {} as Db, actor });
const week = (monday = '09:00-13:00') => [monday, '', '', '', '', '', ''];
const roster = (extra: Record<string, unknown> = {}) => ({
  staffUserId: physioId,
  centreId: hsr,
  effectiveFrom: today,
  days: week(),
  ...extra,
});
const partLeave = (extra: Record<string, unknown> = {}) => ({
  staffUserId: physioId,
  kind: 'part',
  date: tomorrow,
  fromTime: '14:00',
  toTime: '16:00',
  note: '',
  ...extra,
});

// SET-04 done when: managers set rosters; physios request their own leave.
describe('rosters', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.staffRecord.mockResolvedValue({ id: physioId, active: true, treatsPatients: true });
    db.assignedToCentre.mockResolvedValue(true);
    db.rosterVersions.mockResolvedValue([]);
    db.versionsFrom.mockReturnValue([]);
    db.saveRoster.mockResolvedValue('roster-id');
    db.insertLeave.mockResolvedValue(leaveId);
    db.leaveRecord.mockResolvedValue({ id: leaveId, staffUserId: physioId, status: 'requested' });
    db.decideLeave.mockResolvedValue(true);
    db.cancelLeave.mockResolvedValue(true);
  });

  it('are set by managers in their centres, not by physios, the front desk or Finance', async () => {
    await saveRosterService(context(), roster());
    expect(db.saveRoster).toHaveBeenCalledWith(fakeTx, {
      staffUserId: physioId,
      centreId: hsr,
      effectiveFrom: today,
      weekly: [[{ starts: 540, ends: 780 }], [], [], [], [], [], []],
      createdBy: managerId,
    });
    const elsewhere = '00000000-0000-4000-8000-000000000103';
    await expect(saveRosterService(context(), roster({ centreId: elsewhere }))).rejects.toThrow(
      NotAllowedError,
    );
    for (const role of ['front_desk', 'finance', 'physiotherapist'] as const) {
      await expect(saveRosterService(context(member({ role })), roster())).rejects.toThrow(
        NotAllowedError,
      );
    }
    await expect(saveRosterService(context(member({ support: true })), roster())).rejects.toThrow(
      ReadOnlyError,
    );
    expect(db.saveRoster).toHaveBeenCalledTimes(1);
  });

  it('start today or later, on the slot grid, for someone who works at the centre', async () => {
    await expect(
      saveRosterService(context(), roster({ effectiveFrom: addDays(today, -1) })),
    ).rejects.toThrow('Choose today or a later date.');
    await expect(
      saveRosterService(context(), roster({ days: week('09:10-13:00') })),
    ).rejects.toThrow('Use steps of 15 minutes');
    db.assignedToCentre.mockResolvedValueOnce(false);
    await expect(saveRosterService(context(), roster())).rejects.toThrow(
      'They do not work at that centre.',
    );
    db.staffRecord.mockResolvedValueOnce({ id: physioId, active: true, treatsPatients: false });
    await expect(saveRosterService(context(), roster())).rejects.toThrow(
      'Only people who treat patients',
    );
    expect(db.saveRoster).not.toHaveBeenCalled();
  });

  it('never clash with the same person’s hours at another centre', async () => {
    db.versionsFrom.mockReturnValueOnce([
      {
        centreId: koramangala,
        centreName: 'Koramangala',
        effectiveFrom: today,
        weekly: [[{ starts: 720, ends: 900 }], [], [], [], [], [], []],
      },
    ]);
    await expect(saveRosterService(context(), roster())).rejects.toThrow(
      'This overlaps their hours at Koramangala on Monday.',
    );
    expect(db.saveRoster).not.toHaveBeenCalled();
  });
});

describe('leave', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.staffRecord.mockResolvedValue({ id: physioId, active: true, treatsPatients: true });
    db.insertLeave.mockResolvedValue(leaveId);
    db.leaveRecord.mockResolvedValue({ id: leaveId, staffUserId: physioId, status: 'requested' });
    db.decideLeave.mockResolvedValue(true);
    db.cancelLeave.mockResolvedValue(true);
  });

  it('is requested by a physio for themselves only, waiting for a decision', async () => {
    expect(await requestLeave(context(physio), partLeave())).toBe(leaveId);
    expect(db.insertLeave).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ staffUserId: physioId, status: 'requested', allDay: false }),
    );
    const colleague = '00000000-0000-4000-8000-000000000208';
    await expect(
      requestLeave(context(physio), partLeave({ staffUserId: colleague })),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      requestLeave(context(member({ role: 'front_desk' })), partLeave()),
    ).rejects.toThrow(NotAllowedError);
  });

  it('starts today or later when requested, but a manager may record the past', async () => {
    const yesterday = addDays(today, -1);
    await expect(requestLeave(context(physio), partLeave({ date: yesterday }))).rejects.toThrow(
      'Leave can start today or later.',
    );
    await recordLeave(context(), partLeave({ date: yesterday }));
    expect(db.insertLeave).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        staffUserId: physioId,
        status: 'approved',
        requestedBy: managerId,
      }),
    );
    await expect(requestLeave(context(physio), partLeave({ fromTime: '14:10' }))).rejects.toThrow(
      'Use steps of 15 minutes',
    );
  });

  it('is decided by a manager, never by the person it is for', async () => {
    await decideLeaveService(context(), { leaveId, decision: 'decline', reason: 'Short staffed' });
    expect(db.decideLeave).toHaveBeenCalledWith(fakeTx, leaveId, {
      approve: false,
      decidedBy: managerId,
      reason: 'Short staffed',
    });
    // A physio deciding their own: allowed past the own grant, then refused.
    await expect(
      decideLeaveService(context(physio), { leaveId, decision: 'approve', reason: '' }),
    ).rejects.toThrow('Your own leave is decided by another manager or the Super Admin.');
    // A manager deciding their own request.
    db.leaveRecord.mockResolvedValue({ id: leaveId, staffUserId: managerId, status: 'requested' });
    await expect(
      decideLeaveService(context(), { leaveId, decision: 'approve', reason: '' }),
    ).rejects.toThrow(RosterError);
    await expect(recordLeave(context(), partLeave({ staffUserId: managerId }))).rejects.toThrow(
      'Request your own leave from My leave',
    );
    expect(db.decideLeave).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by the person only while it waits', async () => {
    await cancelLeaveService(context(physio), { leaveId });
    expect(db.cancelLeave).toHaveBeenCalledWith(fakeTx, leaveId);
    db.leaveRecord.mockResolvedValue({ id: leaveId, staffUserId: physioId, status: 'approved' });
    await expect(cancelLeaveService(context(physio), { leaveId })).rejects.toThrow(
      'Decided leave is cancelled by your manager.',
    );
    await cancelLeaveService(context(), { leaveId });
    expect(db.cancelLeave).toHaveBeenCalledTimes(2);
  });

  it('refuses overlapping leave with a message, from the database’s exclusion', async () => {
    db.insertLeave.mockRejectedValueOnce(
      Object.assign(new Error('x'), { cause: { code: '23P01' } }),
    );
    await expect(requestLeave(context(physio), partLeave())).rejects.toThrow(
      'This overlaps leave already requested or approved.',
    );
  });
});
