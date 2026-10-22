import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { getSetting } from '../settings/settings';
import {
  SchedulingError,
  addPatientAndBook,
  bookSlot,
  cancelAppointment,
  findFreeSlots,
  holdSlot,
  releaseSlot,
  rescheduleAppointment,
} from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  SlotRefusedError: class SlotRefusedError extends Error {},
  withStaffAccess: vi.fn(),
  currentHold: vi.fn(),
  releaseHold: vi.fn(),
  appointmentRecord: vi.fn(),
  changeAppointment: vi.fn(),
  bookAppointment: vi.fn(),
  episodeRecord: vi.fn(),
  freeSlots: vi.fn(),
  patientRecord: vi.fn(),
  placeHold: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const patients = vi.hoisted(() => ({ addPatient: vi.fn() }));
vi.mock('../patients/services', () => patients);
// Page reads run as the person under row level security, like a transaction here.
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown): unknown =>
    db.withStaffAccess({}, {}, work) as unknown,
}));
// Test values only; the real ones are the `scheduling.slot_minutes` and
// `booking.slot_hold_minutes` rows.
const settings: Record<string, number> = {
  'scheduling.slot_minutes': 15,
  'booking.slot_hold_minutes': 5,
};
vi.mock('../settings/settings', () => ({
  getSetting: vi.fn((key: string) => Promise.resolve(settings[key])),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const physioId = '00000000-0000-4000-8000-000000000207';
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
const choice = {
  centreId: hsr,
  physioId,
  appointmentTypeId: typeId,
  startsAt: '2026-11-02T04:30:00.000Z',
};

// SCH-04: the front desk finds free starts, holds one while choosing and books it, at the
// centres it works in; the engine rechecks inside the transaction.
describe('scheduling', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) if ('mockReset' in fn) fn.mockReset();
    patients.addPatient.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.freeSlots.mockResolvedValue([]);
    db.placeHold.mockResolvedValue({ holdId: 'hold', expiresAt: new Date() });
    db.patientRecord.mockResolvedValue({ id: patientId });
    db.bookAppointment.mockResolvedValue({ id: 'appointment', number: 'MVH-00001' });
  });

  it('finds free starts at a centre the person books for, as their own holder', async () => {
    await findFreeSlots(member(), {
      centreId: hsr,
      date: '2026-11-02',
      appointmentTypeId: typeId,
    });
    expect(db.freeSlots).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ centreId: hsr, holder: `staff:${deskId}`, step: 15 }),
    );
    await expect(
      findFreeSlots(member(), {
        centreId: koramangala,
        date: '2026-11-02',
        appointmentTypeId: typeId,
      }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      findFreeSlots(member({ role: 'finance', centreIds: [] }), {
        centreId: hsr,
        date: '2026-11-02',
        appointmentTypeId: typeId,
      }),
    ).rejects.toThrow(NotAllowedError);
  });

  it('holds a start for the hold setting, for the booking roles only', async () => {
    await holdSlot(context(), choice);
    expect(db.placeHold).toHaveBeenCalledWith(fakeTx, {
      ...choice,
      startsAt: new Date(choice.startsAt),
      holder: `staff:${deskId}`,
      holdMinutes: 5,
      step: 15,
      now: expect.any(Date) as Date,
    });
    await expect(holdSlot(context(), { ...choice, centreId: koramangala })).rejects.toThrow(
      NotAllowedError,
    );
    await expect(
      holdSlot(context(member({ role: 'physiotherapist', treatsPatients: true })), choice),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      holdSlot(context(member({ role: 'super_admin', support: true })), choice),
    ).rejects.toThrow(ReadOnlyError);
    await expect(holdSlot(context(), { ...choice, startsAt: 'soon' })).rejects.toThrow(z.ZodError);
  });

  it('books at the front desk, recording who booked', async () => {
    expect(await bookSlot(context(), { ...choice, patientId })).toEqual({
      id: 'appointment',
      number: 'MVH-00001',
    });
    expect(db.bookAppointment).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        patientId,
        channel: 'front_desk',
        bookedBy: deskId,
        holder: `staff:${deskId}`,
      }),
    );
  });

  it('books only for a patient found, into an open episode of theirs', async () => {
    db.patientRecord.mockResolvedValueOnce(undefined);
    await expect(bookSlot(context(), { ...choice, patientId })).rejects.toThrow(SchedulingError);
    for (const episode of [
      { id: episodeId, patientId: physioId, status: 'active' },
      { id: episodeId, patientId, status: 'discharged' },
      undefined,
    ]) {
      db.episodeRecord.mockResolvedValueOnce(episode);
      await expect(bookSlot(context(), { ...choice, patientId, episodeId })).rejects.toThrow(
        'Book into an open episode of the same patient.',
      );
    }
    expect(db.bookAppointment).not.toHaveBeenCalled();
    db.episodeRecord.mockResolvedValueOnce({ id: episodeId, patientId, status: 'active' });
    await bookSlot(context(), { ...choice, patientId, episodeId });
    expect(db.bookAppointment).toHaveBeenCalled();
  });

  it('reads the settings before the transaction opens', async () => {
    // One database connection per server instance: a settings load inside the transaction
    // would wait for that connection for ever (SET-03).
    const order: string[] = [];
    vi.mocked(getSetting).mockImplementation((key: string) => {
      order.push('setting');
      return Promise.resolve(settings[key] as never);
    });
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => {
        order.push('transaction');
        return work(fakeTx);
      },
    );
    await holdSlot(context(), choice);
    await bookSlot(context(), { ...choice, patientId });
    await findFreeSlots(member(), {
      centreId: hsr,
      date: '2026-11-02',
      appointmentTypeId: typeId,
    });
    expect(order).toEqual([
      'setting',
      'setting',
      'transaction',
      'setting',
      'transaction',
      'setting',
      'transaction',
    ]);
  });

  // SCH-07: Cancel gives back the person's own hold; a new caller is added with a name and mobile
  // and booked, or the patients already on the mobile come back first.
  it('gives back only the person’s own hold, at a centre they book for', async () => {
    await releaseSlot(context(), { centreId: hsr });
    expect(db.releaseHold).toHaveBeenCalledWith(fakeTx, `staff:${deskId}`);
    await expect(releaseSlot(context(), { centreId: koramangala })).rejects.toThrow(
      NotAllowedError,
    );
    await expect(
      releaseSlot(context(member({ role: 'finance', centreIds: [] })), { centreId: hsr }),
    ).rejects.toThrow(NotAllowedError);
    expect(db.releaseHold).toHaveBeenCalledTimes(1);
  });

  const caller = { ...choice, name: 'Test Caller', phone: '98450 12345' };

  it('adds a new caller at the booking’s centre, then books them', async () => {
    patients.addPatient.mockResolvedValue({ status: 'added', id: patientId, opNumber: 'HSR-1' });
    const result = await addPatientAndBook(context(), caller);
    expect(patients.addPatient).toHaveBeenCalledWith(expect.anything(), {
      name: 'Test Caller',
      phone: '+919845012345',
      registeredCentreId: hsr,
      confirmNewPerson: false,
    });
    expect(db.bookAppointment).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ patientId, channel: 'front_desk', bookedBy: deskId }),
    );
    expect(result).toEqual({ status: 'booked', id: 'appointment', number: 'MVH-00001' });
  });

  it('shows the patients on a mobile first, and keeps an added patient when the slot is gone', async () => {
    const matches = [
      { id: patientId, name: 'Test Patient', phone: '+919845012345', opNumber: 'HSR-1' },
    ];
    patients.addPatient.mockResolvedValueOnce({ status: 'matches', matches });
    expect(await addPatientAndBook(context(), caller)).toEqual({ status: 'matches', matches });
    expect(db.bookAppointment).not.toHaveBeenCalled();

    patients.addPatient.mockResolvedValueOnce({
      status: 'added',
      id: patientId,
      opNumber: 'HSR-2',
    });
    db.bookAppointment.mockRejectedValueOnce(
      new db.SlotRefusedError('This slot was just booked. Pick another time.'),
    );
    const refused = addPatientAndBook(context(), { ...caller, confirmNewPerson: true });
    await expect(refused).rejects.toThrow(SchedulingError);
    await expect(refused).rejects.toThrow(
      'Added Test Caller (HSR-2). This slot was just booked. Pick another time.',
    );
  });

  it('wants a name and a mobile for a new caller', async () => {
    await expect(addPatientAndBook(context(), { ...caller, name: ' ' })).rejects.toThrow(
      z.ZodError,
    );
    await expect(addPatientAndBook(context(), { ...caller, phone: '123' })).rejects.toThrow(
      z.ZodError,
    );
    expect(patients.addPatient).not.toHaveBeenCalled();
  });

  // SCH-08: a Booked or Confirmed appointment is cancelled or moved, recording who asked; a move
  // marks the old one and books the new one in the same transaction.
  const appointmentId = '00000000-0000-4000-8000-000000000801';
  const old = {
    id: appointmentId,
    number: 'MVH-00001',
    patientId,
    centreId: hsr,
    physioId,
    appointmentTypeId: typeId,
    episodeId,
    startsAt: new Date('2026-11-02T04:30:00.000Z'),
    endsAt: new Date('2026-11-02T05:15:00.000Z'),
    status: 'booked',
    channel: 'whatsapp',
    bookedBy: null,
    machineUnit: null,
    changeReason: null,
    rescheduledFromId: null,
  };

  it('cancels with who asked and who did it, only while booked or confirmed', async () => {
    db.appointmentRecord.mockResolvedValue(old);
    db.changeAppointment.mockResolvedValueOnce({ id: appointmentId });
    await cancelAppointment(context(), { appointmentId, reason: 'patient' });
    expect(db.changeAppointment).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        appointmentId,
        status: 'cancelled',
        reason: 'patient',
        changedBy: deskId,
      }),
    );
    db.changeAppointment.mockResolvedValueOnce(undefined);
    await expect(cancelAppointment(context(), { appointmentId, reason: 'clinic' })).rejects.toThrow(
      'Only a booked or confirmed appointment can be cancelled.',
    );
    await expect(cancelAppointment(context(), { appointmentId, reason: '' })).rejects.toThrow(
      'Choose who asked for the change.',
    );
  });

  it('moves an appointment: marks the old one, then books the same patient, type and episode', async () => {
    db.appointmentRecord.mockResolvedValue(old);
    db.changeAppointment.mockResolvedValue({ id: appointmentId });
    db.bookAppointment.mockResolvedValue({ id: 'new', number: 'MVH-00002' });
    const otherPhysio = '00000000-0000-4000-8000-000000000208';
    const moved = await rescheduleAppointment(context(), {
      appointmentId,
      physioId: otherPhysio,
      startsAt: '2026-11-03T05:00:00.000Z',
      reason: 'clinic',
    });
    expect(moved).toEqual({ id: 'new', number: 'MVH-00002' });
    expect(db.changeAppointment).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ status: 'rescheduled', reason: 'clinic', changedBy: deskId }),
    );
    expect(db.bookAppointment).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        centreId: hsr,
        physioId: otherPhysio,
        appointmentTypeId: typeId,
        patientId,
        episodeId,
        channel: 'front_desk',
        bookedBy: deskId,
        rescheduledFromId: appointmentId,
        holder: `staff:${deskId}`,
      }),
    );
    // Both in one transaction, the old one first: a refused new start undoes the change.
    expect(db.withStaffAccess).toHaveBeenCalledTimes(1);
    expect(db.changeAppointment.mock.invocationCallOrder[0]).toBeLessThan(
      db.bookAppointment.mock.invocationCallOrder[0] ?? 0,
    );
    db.bookAppointment.mockRejectedValueOnce(new db.SlotRefusedError('taken'));
    await expect(
      rescheduleAppointment(context(), {
        appointmentId,
        physioId,
        startsAt: '2026-11-03T05:00:00.000Z',
        reason: 'patient',
      }),
    ).rejects.toThrow(db.SlotRefusedError);
  });

  it('changes appointments only for the booking roles at their centres', async () => {
    db.appointmentRecord.mockResolvedValue({ ...old, centreId: koramangala });
    await expect(
      cancelAppointment(context(), { appointmentId, reason: 'patient' }),
    ).rejects.toThrow(NotAllowedError);
    db.appointmentRecord.mockResolvedValue(old);
    for (const actor of [
      member({ role: 'physiotherapist', treatsPatients: true }),
      member({ role: 'finance', centreIds: [] }),
    ]) {
      await expect(
        cancelAppointment(context(actor), { appointmentId, reason: 'patient' }),
      ).rejects.toThrow(NotAllowedError);
    }
    expect(db.changeAppointment).not.toHaveBeenCalled();
  });

  it('frees only a movable appointment of the same centre and type when picking a new time', async () => {
    db.appointmentRecord.mockResolvedValue(old);
    await findFreeSlots(member(), {
      centreId: hsr,
      date: '2026-11-02',
      appointmentTypeId: typeId,
      freeing: appointmentId,
    });
    expect(db.freeSlots).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ freeing: appointmentId }),
    );
    db.appointmentRecord.mockResolvedValue({ ...old, status: 'checked_in' });
    await expect(holdSlot(context(), { ...choice, freeing: appointmentId })).rejects.toThrow(
      SchedulingError,
    );
    db.appointmentRecord.mockResolvedValue({ ...old, appointmentTypeId: episodeId });
    await expect(holdSlot(context(), { ...choice, freeing: appointmentId })).rejects.toThrow(
      'Only a booked or confirmed appointment can be moved.',
    );
    expect(db.placeHold).not.toHaveBeenCalled();
  });
});
