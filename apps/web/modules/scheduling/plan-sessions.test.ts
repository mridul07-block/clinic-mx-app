import type { Db, StaffMember } from '@clinic-mx/db';
import { istInstant } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { bookPlanSessions, planSessionsOf, previewPlanSessions } from './plan-sessions';
import { SchedulingError } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  SlotRefusedError: class SlotRefusedError extends Error {},
  withStaffAccess: vi.fn(),
  appointmentTypeIdByKey: vi.fn(),
  bookAppointment: vi.fn(),
  episodeRecord: vi.fn(),
  episodeSessionCounts: vi.fn(),
  packagesOfEpisode: vi.fn(),
  physiosForType: vi.fn(),
  planForPricing: vi.fn(),
  recordPlanBooking: vi.fn(),
  seriesFit: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown): unknown =>
    db.withStaffAccess({}, {}, work) as unknown,
}));
// Test values only; the real ones are the settings rows.
const settings: Record<string, unknown> = {
  'scheduling.slot_minutes': 15,
  'booking.plan_clash_alternatives': 3,
  'packages.session_appointment_types': ['session', 'zero_gravity_treadmill'],
};
vi.mock('../settings/settings', () => ({
  getSetting: vi.fn((key: string) => Promise.resolve(settings[key])),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const physioId = '00000000-0000-4000-8000-000000000207';
const otherPhysio = '00000000-0000-4000-8000-000000000208';
const patientId = '00000000-0000-4000-8000-000000000301';
const episodeId = '00000000-0000-4000-8000-000000000501';
const typeId = '00000000-0000-4000-8000-000000000601';
const deskId = '00000000-0000-4000-8000-000000000204';
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

// A start date far enough ahead that it is never in the past.
const fromDate = '2099-11-02';
const pattern = { episodeId, fromDate, weekdays: ['1', '3'], time: '10:00', physioId };
const starts = ['2099-11-02', '2099-11-04', '2099-11-09', '2099-11-11'].map((date) =>
  istInstant(date, 600),
);

// SCH-11 (user decisions, 26 October 2026): once the episode is Active, those who book at its
// centre book the plan's remaining sessions from a weekly pattern, all or nothing.
describe('Book plan sessions', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) if ('mockReset' in fn) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.episodeRecord.mockResolvedValue({
      id: episodeId,
      patientId,
      centreId: hsr,
      status: 'active',
    });
    db.planForPricing.mockResolvedValue({
      sessionsPerWeek: 2,
      weeks: 3,
      treatingPhysioId: physioId,
    });
    db.episodeSessionCounts.mockResolvedValue({ booked: 1, done: 1 });
    db.packagesOfEpisode.mockResolvedValue([]);
    db.appointmentTypeIdByKey.mockResolvedValue(typeId);
    db.physiosForType.mockResolvedValue([{ id: physioId, name: 'Test Physio', consultant: false }]);
    db.seriesFit.mockResolvedValue([]);
    db.recordPlanBooking.mockResolvedValue('series');
    db.bookAppointment.mockImplementation((_tx: unknown, request: { startsAt: Date }) =>
      Promise.resolve({ id: request.startsAt.toISOString(), number: 'MVH-00001' }),
    );
  });

  it('counts the plan less what is booked or done, capped by an active package', async () => {
    const view = await planSessionsOf(member(), episodeId);
    expect(view).toMatchObject({ planned: 6, booked: 1, done: 1, toBook: 4, canBook: true });
    expect(view?.suggestedPhysioId).toBe(physioId);
    expect(db.episodeSessionCounts).toHaveBeenCalledWith(fakeTx, episodeId, [
      'session',
      'zero_gravity_treadmill',
    ]);
    expect(db.appointmentTypeIdByKey).toHaveBeenCalledWith(fakeTx, 'session');
    db.packagesOfEpisode.mockResolvedValueOnce([
      { state: 'active', sessionsLeft: 3 },
      { state: 'cancelled', sessionsLeft: 10 },
    ]);
    expect(await planSessionsOf(member(), episodeId)).toMatchObject({ packageLeft: 3, toBook: 2 });
  });

  it('is not offered before payment, to Finance, or at another centre', async () => {
    db.episodeRecord.mockResolvedValueOnce({
      id: episodeId,
      centreId: hsr,
      status: 'plan_proposed',
    });
    expect(await planSessionsOf(member(), episodeId)).toMatchObject({ canBook: false });
    expect(await planSessionsOf(member({ role: 'finance' }), episodeId)).toMatchObject({
      mayBook: false,
    });
    expect(
      await planSessionsOf(
        member({ centreIds: ['00000000-0000-4000-8000-000000000102'] }),
        episodeId,
      ),
    ).toMatchObject({ mayBook: false });
  });

  it("checks the pattern's dates with the clash alternatives setting", async () => {
    await previewPlanSessions(member(), pattern);
    expect(db.seriesFit).toHaveBeenCalledWith(fakeTx, {
      centreId: hsr,
      physioId,
      appointmentTypeId: typeId,
      starts,
      holder: `plan-series:${deskId}`,
      step: 15,
      now: expect.any(Date) as Date,
      alternatives: 3,
    });
  });

  it('refuses a pattern that does not fit the plan or the moment', async () => {
    await expect(previewPlanSessions(member(), { ...pattern, weekdays: ['1'] })).rejects.toThrow(
      'Tick 2 days: the plan is 2 a week.',
    );
    await expect(
      previewPlanSessions(member(), { ...pattern, fromDate: '2020-01-01' }),
    ).rejects.toThrow('Start today or later.');
    await expect(
      previewPlanSessions(member(), { ...pattern, physioId: otherPhysio }),
    ).rejects.toThrow('That physio does not take sessions at this centre. Pick another.');
    db.episodeRecord.mockResolvedValueOnce({
      id: episodeId,
      centreId: hsr,
      status: 'plan_proposed',
    });
    await expect(previewPlanSessions(member(), pattern)).rejects.toThrow(
      'Book plan sessions once the plan is paid.',
    );
    db.episodeSessionCounts.mockResolvedValueOnce({ booked: 6, done: 0 });
    await expect(previewPlanSessions(member(), pattern)).rejects.toThrow(
      'All planned sessions are booked.',
    );
    await expect(
      previewPlanSessions(member({ centreIds: ['00000000-0000-4000-8000-000000000102'] }), pattern),
    ).rejects.toThrow(NotAllowedError);
    expect(db.seriesFit).not.toHaveBeenCalled();
  });

  it('records the series, then books each start in it as the desk', async () => {
    const result = await bookPlanSessions(context(), { ...pattern, starts: starts.slice(0, 3) });
    expect(result.planBookingId).toBe('series');
    expect(result.booked).toHaveLength(3);
    expect(db.recordPlanBooking).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      centreId: hsr,
      physioId,
      appointmentTypeId: typeId,
      fromDate,
      weekdays: [1, 3],
      time: '10:00',
      bookedBy: deskId,
    });
    expect(db.bookAppointment).toHaveBeenCalledTimes(3);
    expect(db.bookAppointment).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        patientId,
        episodeId,
        channel: 'front_desk',
        bookedBy: deskId,
        planBookingId: 'series',
        startsAt: starts[0],
      }),
    );
  });

  it('refuses more than is left, and a start no longer free refuses the whole series', async () => {
    const five = [...starts, istInstant('2099-11-16', 600)];
    await expect(bookPlanSessions(context(), { ...pattern, starts: five })).rejects.toThrow(
      'Only 4 sessions are left to book. Check dates again.',
    );
    db.bookAppointment.mockRejectedValueOnce(new db.SlotRefusedError('taken'));
    await expect(bookPlanSessions(context(), { ...pattern, starts })).rejects.toThrow(
      new SchedulingError(
        'Mon 2 Nov 2099, 10:00 AM is no longer free. Nothing was booked. Check dates again.',
      ),
    );
  });

  it('is for those who book, never a support login', async () => {
    await expect(
      bookPlanSessions(context(member({ role: 'finance' })), { ...pattern, starts }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      bookPlanSessions(context(member({ role: 'super_admin', support: true })), {
        ...pattern,
        starts,
      }),
    ).rejects.toThrow(ReadOnlyError);
    expect(db.recordPlanBooking).not.toHaveBeenCalled();
  });
});
