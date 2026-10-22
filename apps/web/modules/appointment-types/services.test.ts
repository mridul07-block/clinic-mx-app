import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import {
  AppointmentTypeError,
  addAppointmentType,
  editAppointmentType,
  setAppointmentTypeActiveService,
  setPhysioLengthsService,
} from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  appointmentTypeKeyTaken: vi.fn(),
  appointmentTypeList: vi.fn(),
  appointmentTypeNameTaken: vi.fn(),
  appointmentTypeRecord: vi.fn(),
  insertAppointmentType: vi.fn(),
  setAppointmentTypeActive: vi.fn(),
  setPhysioLengths: vi.fn(),
  staffRecord: vi.fn(),
  updateAppointmentType: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
// Test value only; the real one is the `scheduling.slot_minutes` row.
vi.mock('../settings/settings', () => ({ getSetting: vi.fn(() => Promise.resolve(15)) }));

const session = '00000000-0000-4000-8000-000000000601';
const review = '00000000-0000-4000-8000-000000000602';
const newId = '00000000-0000-4000-8000-000000000609';
const physioId = '00000000-0000-4000-8000-000000000207';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000201',
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
const type = (id: string, name: string, minutes: number) => ({
  id,
  key: name.toLowerCase(),
  name,
  minutes,
  active: true,
  physioLengths: 0,
});

// SET-03 done when: length per type and per physio, kept by the Super Admin.
describe('appointment types', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.appointmentTypeNameTaken.mockResolvedValue(false);
    db.appointmentTypeKeyTaken.mockResolvedValue(false);
    db.insertAppointmentType.mockResolvedValue(newId);
    db.appointmentTypeRecord.mockResolvedValue(type(review, 'Review', 45));
    db.appointmentTypeList.mockResolvedValue([
      type(session, 'Session', 45),
      type(review, 'Review', 45),
    ]);
    db.setAppointmentTypeActive.mockResolvedValue(true);
    db.staffRecord.mockResolvedValue({ id: physioId, treatsPatients: true });
  });

  it('are kept by the Super Admin only; read only for Velyx support', async () => {
    expect(await addAppointmentType(context(), { name: 'Home visit', minutes: '60' })).toBe(newId);
    expect(db.insertAppointmentType).toHaveBeenCalledWith(fakeTx, {
      key: 'home_visit',
      name: 'Home visit',
      minutes: 60,
    });
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist', 'finance'] as const) {
      await expect(
        addAppointmentType(context(member({ role })), { name: 'Home visit', minutes: '60' }),
      ).rejects.toThrow(NotAllowedError);
      await expect(
        setPhysioLengthsService(context(member({ role })), { staffUserId: physioId, lengths: [] }),
      ).rejects.toThrow(NotAllowedError);
    }
    await expect(
      addAppointmentType(context(member({ support: true })), { name: 'Home visit', minutes: '60' }),
    ).rejects.toThrow(ReadOnlyError);
    expect(db.insertAppointmentType).toHaveBeenCalledTimes(1);
  });

  it('take lengths in whole calendar slots only', async () => {
    await expect(
      editAppointmentType(context(), { appointmentTypeId: review, name: 'Review', minutes: '50' }),
    ).rejects.toThrow('Use steps of 15 minutes, for example 45.');
    await editAppointmentType(context(), {
      appointmentTypeId: review,
      name: 'Review',
      minutes: '30',
    });
    expect(db.updateAppointmentType).toHaveBeenCalledWith(fakeTx, review, {
      name: 'Review',
      minutes: 30,
    });
    expect(db.updateAppointmentType).toHaveBeenCalledTimes(1);
  });

  it('refuse a name in use, a key in use and a bad length', async () => {
    db.appointmentTypeNameTaken.mockResolvedValueOnce(true);
    await expect(addAppointmentType(context(), { name: 'Review', minutes: '45' })).rejects.toThrow(
      'An appointment type with this name already exists.',
    );
    db.appointmentTypeKeyTaken.mockResolvedValueOnce(true);
    await expect(addAppointmentType(context(), { name: 'Re-view', minutes: '45' })).rejects.toThrow(
      AppointmentTypeError,
    );
    await expect(addAppointmentType(context(), { name: 'Review', minutes: '' })).rejects.toThrow(
      z.ZodError,
    );
    expect(db.insertAppointmentType).not.toHaveBeenCalled();
  });

  it('deactivate and reactivate once each', async () => {
    await setAppointmentTypeActiveService(context(), { appointmentTypeId: review, active: false });
    expect(db.setAppointmentTypeActive).toHaveBeenCalledWith(fakeTx, review, false);
    db.setAppointmentTypeActive.mockResolvedValueOnce(false);
    await expect(
      setAppointmentTypeActiveService(context(), { appointmentTypeId: review, active: false }),
    ).rejects.toThrow('already inactive');
  });

  it('set a physio’s own lengths, blank meaning the type’s', async () => {
    await setPhysioLengthsService(context(), {
      staffUserId: physioId,
      lengths: [
        { appointmentTypeId: session, minutes: '60' },
        { appointmentTypeId: review, minutes: '' },
      ],
    });
    expect(db.setPhysioLengths).toHaveBeenCalledWith(fakeTx, physioId, [
      { appointmentTypeId: session, minutes: 60 },
      { appointmentTypeId: review, minutes: null },
    ]);
  });

  it('refuse lengths for staff who do not treat patients, unknown types and odd lengths', async () => {
    db.staffRecord.mockResolvedValueOnce({ id: physioId, treatsPatients: false });
    await expect(
      setPhysioLengthsService(context(), {
        staffUserId: physioId,
        lengths: [{ appointmentTypeId: session, minutes: '60' }],
      }),
    ).rejects.toThrow('Only staff who treat patients have appointment lengths.');
    await expect(
      setPhysioLengthsService(context(), {
        staffUserId: physioId,
        lengths: [{ appointmentTypeId: newId, minutes: '60' }],
      }),
    ).rejects.toThrow('not found');
    await expect(
      setPhysioLengthsService(context(), {
        staffUserId: physioId,
        lengths: [{ appointmentTypeId: session, minutes: '50' }],
      }),
    ).rejects.toThrow('Use steps of 15 minutes');
    expect(db.setPhysioLengths).not.toHaveBeenCalled();
  });
});
