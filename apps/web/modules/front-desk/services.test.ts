import type { Db, StaffMember } from '@clinic-mx/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { SchedulingError } from '../scheduling/services';
import { checkIn, undoCheckIn } from './services';
import { loadToday } from './today';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  appointmentRecord: vi.fn(),
  checkIn: vi.fn(),
  undoCheckIn: vi.fn(),
  todayBoard: vi.fn(),
  contentVersion: vi.fn(() => 'v1'),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown): unknown =>
    db.withStaffAccess({}, {}, work) as unknown,
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const deskId = '00000000-0000-4000-8000-000000000204';
const appointmentId = '00000000-0000-4000-8000-000000000801';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: deskId,
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
// 10:00 IST on 2 November 2026.
const booked = {
  id: appointmentId,
  centreId: hsr,
  startsAt: new Date('2026-11-02T04:30:00.000Z'),
  status: 'booked',
};
const refusedFor = [
  member({ role: 'physiotherapist', treatsPatients: true }),
  member({ role: 'finance', centreIds: [] }),
  member({ centreIds: [koramangala] }),
];

// INT-01: the front desk checks a patient in on the appointment's day at its centre, and undoes a
// check in made by mistake on that day; the board is for those who check in.
describe('front desk today', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) if ('mockReset' in fn) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.contentVersion.mockReturnValue('v1');
    vi.useFakeTimers({ now: new Date('2026-11-02T03:00:00.000Z'), toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks a booked or confirmed patient in on the day', async () => {
    db.appointmentRecord.mockResolvedValue(booked);
    db.checkIn.mockResolvedValue({ id: appointmentId });
    await checkIn(context(), { appointmentId });
    expect(db.checkIn).toHaveBeenCalledWith(fakeTx, {
      appointmentId,
      now: new Date('2026-11-02T03:00:00.000Z'),
    });

    db.appointmentRecord.mockResolvedValue({ ...booked, status: 'no_show' });
    await expect(checkIn(context(), { appointmentId })).rejects.toThrow(
      'Only a booked or confirmed appointment is checked in.',
    );
    db.appointmentRecord.mockResolvedValue(booked);
    // 00:00 IST on 3 November.
    vi.setSystemTime(new Date('2026-11-02T18:30:00.000Z'));
    await expect(checkIn(context(), { appointmentId })).rejects.toThrow(SchedulingError);
    expect(db.checkIn).toHaveBeenCalledTimes(1);
  });

  it('checks in for those who check in at the centre only', async () => {
    db.appointmentRecord.mockResolvedValue(booked);
    for (const actor of refusedFor) {
      await expect(checkIn(context(actor), { appointmentId })).rejects.toThrow(NotAllowedError);
    }
    expect(db.checkIn).not.toHaveBeenCalled();
  });

  it('undoes a check in on the day only', async () => {
    db.appointmentRecord.mockResolvedValue({ ...booked, status: 'checked_in' });
    db.undoCheckIn.mockResolvedValue({ id: appointmentId });
    await undoCheckIn(context(member({ role: 'centre_manager' })), { appointmentId });
    expect(db.undoCheckIn).toHaveBeenCalledWith(fakeTx, expect.objectContaining({ appointmentId }));
    vi.setSystemTime(new Date('2026-11-02T18:30:00.000Z'));
    await expect(undoCheckIn(context(), { appointmentId })).rejects.toThrow(
      'A check in can only be undone on the appointment’s day.',
    );
    db.appointmentRecord.mockResolvedValue(booked);
    await expect(undoCheckIn(context(), { appointmentId })).rejects.toThrow(
      'This appointment is not checked in.',
    );
    expect(db.undoCheckIn).toHaveBeenCalledTimes(1);
  });

  it('loads the board for those who check in at the centre', async () => {
    db.todayBoard.mockResolvedValue([]);
    expect(await loadToday(member(), { centreId: hsr, date: '2026-11-02' })).toEqual({
      appointments: [],
      version: 'v1',
    });
    expect(db.todayBoard).toHaveBeenCalledWith(fakeTx, { centreId: hsr, date: '2026-11-02' });
    for (const actor of refusedFor) {
      await expect(loadToday(actor, { centreId: hsr, date: '2026-11-02' })).rejects.toThrow(
        NotAllowedError,
      );
    }
  });
});
