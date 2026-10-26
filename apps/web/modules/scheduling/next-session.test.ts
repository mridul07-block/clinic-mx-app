import type { Db, StaffMember } from '@clinic-mx/db';
import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { bookNextSession, nextSessionPanel, nextSessionTimes } from './next-session';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  SlotRefusedError: class SlotRefusedError extends Error {},
  withStaffAccess: vi.fn(),
  appointmentTypeIdByKey: vi.fn(),
  bookAppointment: vi.fn(),
  episodeRecord: vi.fn(),
  episodeSessionCounts: vi.fn(),
  freeSlots: vi.fn(),
  packagesOfEpisode: vi.fn(),
  planFrequencyOf: vi.fn(),
  sessionNoteOf: vi.fn(),
  sessionVisit: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown): unknown =>
    db.withStaffAccess({}, {}, work) as unknown,
}));
// Test values only; the real ones are the settings rows.
const settings: Record<string, unknown> = {
  'scheduling.slot_minutes': 15,
  'packages.session_appointment_types': ['session', 'zero_gravity_treadmill'],
};
vi.mock('../settings/settings', () => ({
  getSetting: vi.fn((key: string) => Promise.resolve(settings[key])),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const physioId = '00000000-0000-4000-8000-000000000207';
const colleagueId = '00000000-0000-4000-8000-000000000208';
const patientId = '00000000-0000-4000-8000-000000000301';
const episodeId = '00000000-0000-4000-8000-000000000501';
const appointmentId = '00000000-0000-4000-8000-000000000701';
const typeId = '00000000-0000-4000-8000-000000000601';
const physio = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: physioId,
  email: 'physio@clinicmx.test',
  name: 'Test Physio',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const context = (actor = physio()) => ({ db: {} as Db, actor });
const visit = (extra = {}) => ({
  id: appointmentId,
  physioId,
  startedBy: physioId,
  centreId: hsr,
  episodeId,
  patientId,
  ...extra,
});
const tomorrow = addDays(istDate(new Date()), 1);

// SCH-12 (user decisions, 26 October 2026): the physio writing the note books the patient's next
// Session into their own free time, in an Active episode, capped like Book plan sessions.
describe('the physio books the next session', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) if ('mockReset' in fn) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.sessionVisit.mockResolvedValue(visit());
    db.sessionNoteOf.mockResolvedValue({ physioId });
    db.episodeRecord.mockResolvedValue({ id: episodeId, centreId: hsr, status: 'active' });
    db.planFrequencyOf.mockResolvedValue({ sessionsPerWeek: 2, weeks: 6 });
    db.episodeSessionCounts.mockResolvedValue({ booked: 1, done: 3 });
    db.packagesOfEpisode.mockResolvedValue([]);
    db.appointmentTypeIdByKey.mockResolvedValue(typeId);
    db.freeSlots.mockResolvedValue([]);
    db.bookAppointment.mockResolvedValue({ id: 'next', number: 'MVH-00002' });
  });

  it('gives the writer the panel: what is left and the date from the plan', async () => {
    const panel = await nextSessionPanel(physio(), appointmentId);
    expect(panel).toEqual({
      appointmentId,
      toBook: 8,
      defaultDate: addDays(istDate(new Date()), 4),
      today: istDate(new Date()),
    });
    expect(db.episodeSessionCounts).toHaveBeenCalledWith(fakeTx, episodeId, [
      'session',
      'zero_gravity_treadmill',
    ]);
  });

  it('gives no panel to a reader, outside an Active episode, or to a support login', async () => {
    db.sessionNoteOf.mockResolvedValueOnce({ physioId: colleagueId });
    expect(await nextSessionPanel(physio(), appointmentId)).toBeUndefined();
    db.episodeRecord.mockResolvedValueOnce({ id: episodeId, status: 'plan_proposed' });
    expect(await nextSessionPanel(physio(), appointmentId)).toBeUndefined();
    db.sessionVisit.mockResolvedValueOnce(visit({ episodeId: null }));
    expect(await nextSessionPanel(physio(), appointmentId)).toBeUndefined();
    expect(
      await nextSessionPanel(physio({ role: 'super_admin', support: true }), appointmentId),
    ).toBeUndefined();
    expect(await nextSessionPanel(physio({ role: 'finance' }), appointmentId)).toBeUndefined();
  });

  it('lists only their own free times at the visit’s centre', async () => {
    await nextSessionTimes(physio(), { appointmentId, date: tomorrow });
    expect(db.freeSlots).toHaveBeenCalledWith(fakeTx, {
      centreId: hsr,
      appointmentTypeId: typeId,
      date: tomorrow,
      physioId,
      holder: `next-session:${physioId}`,
      step: 15,
      now: expect.any(Date) as Date,
    });
    await expect(nextSessionTimes(physio(), { appointmentId, date: '2020-01-01' })).rejects.toThrow(
      'Pick today or later.',
    );
  });

  it('books with the physio, as them, in the visit’s episode', async () => {
    const startsAt = istInstant(tomorrow, 600);
    expect(await bookNextSession(context(), { appointmentId, startsAt })).toEqual({
      id: 'next',
      number: 'MVH-00002',
      startsAt,
    });
    expect(db.bookAppointment).toHaveBeenCalledWith(fakeTx, {
      centreId: hsr,
      physioId,
      appointmentTypeId: typeId,
      startsAt,
      holder: `next-session:${physioId}`,
      patientId,
      episodeId,
      channel: 'front_desk',
      bookedBy: physioId,
      step: 15,
      now: expect.any(Date) as Date,
    });
  });

  it('refuses a reader, an unpaid plan, nothing left, other roles and support', async () => {
    const input = { appointmentId, startsAt: istInstant(tomorrow, 600) };
    db.sessionNoteOf.mockResolvedValueOnce({ physioId: colleagueId });
    await expect(bookNextSession(context(), input)).rejects.toThrow(
      'Only the physio writing this session books its next one.',
    );
    db.episodeRecord.mockResolvedValueOnce({ id: episodeId, status: 'plan_proposed' });
    await expect(bookNextSession(context(), input)).rejects.toThrow(
      'Book the next session once the plan is paid.',
    );
    db.episodeSessionCounts.mockResolvedValueOnce({ booked: 4, done: 8 });
    await expect(bookNextSession(context(), input)).rejects.toThrow(
      'All planned sessions are booked.',
    );
    await expect(bookNextSession(context(physio({ role: 'finance' })), input)).rejects.toThrow(
      NotAllowedError,
    );
    await expect(
      bookNextSession(
        context(physio({ centreIds: ['00000000-0000-4000-8000-000000000102'] })),
        input,
      ),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      bookNextSession(context(physio({ role: 'super_admin', support: true })), input),
    ).rejects.toThrow(ReadOnlyError);
    expect(db.bookAppointment).not.toHaveBeenCalled();
  });
});
