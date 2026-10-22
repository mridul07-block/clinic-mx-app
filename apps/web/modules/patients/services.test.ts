import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { PatientError, addPatient, editPatient } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  insertPatient: vi.fn(),
  patientsOnPhone: vi.fn(),
  updatePatient: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const patientId = '00000000-0000-4000-8000-000000000301';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000203',
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
// Generated test details only (rule 12).
const details = { name: 'Test Patient', phone: '99000 00001', registeredCentreId: hsr };
const sibling = {
  id: patientId,
  name: 'Test Sibling',
  phone: '+919900000001',
  opNumber: 'HSR-00001',
};

// SCH-01 done when: several patients per phone number; OP number from a per centre sequence.
describe('patients', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.patientsOnPhone.mockResolvedValue([]);
    db.insertPatient.mockResolvedValue({ id: patientId, opNumber: 'HSR-00002' });
    db.updatePatient.mockResolvedValue(true);
  });

  it('adds a patient with a name and a mobile, and gives back the OP number', async () => {
    expect(await addPatient(context(), details)).toEqual({
      status: 'added',
      id: patientId,
      opNumber: 'HSR-00002',
    });
    expect(db.insertPatient).toHaveBeenCalledWith(fakeTx, {
      name: 'Test Patient',
      phone: '+919900000001',
      registeredCentreId: hsr,
    });
  });

  it('shows the patients already on a mobile before adding another person to it', async () => {
    db.patientsOnPhone.mockResolvedValue([sibling]);
    expect(await addPatient(context(), details)).toEqual({ status: 'matches', matches: [sibling] });
    expect(db.insertPatient).not.toHaveBeenCalled();

    expect(await addPatient(context(), { ...details, confirmNewPerson: true })).toMatchObject({
      status: 'added',
    });
    expect(db.insertPatient).toHaveBeenCalledOnce();
  });

  it('adds patients only at a centre the person works in', async () => {
    await expect(
      addPatient(context(), { ...details, registeredCentreId: koramangala }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      addPatient(context(member({ role: 'super_admin', centreIds: [] })), {
        ...details,
        registeredCentreId: koramangala,
      }),
    ).resolves.toMatchObject({ status: 'added' });
  });

  it('is for the Super Admin, Centre Managers and the Front Desk; read only for support', async () => {
    for (const role of ['physiotherapist', 'finance'] as const) {
      await expect(addPatient(context(member({ role })), details)).rejects.toThrow(NotAllowedError);
      await expect(
        editPatient(context(member({ role })), { ...details, patientId }),
      ).rejects.toThrow(NotAllowedError);
    }
    await expect(
      addPatient(context(member({ role: 'super_admin', support: true })), details),
    ).rejects.toThrow(ReadOnlyError);
    await expect(
      addPatient(context(member({ role: 'centre_manager' })), details),
    ).resolves.toMatchObject({ status: 'added' });
  });

  it('refuses bad details before writing', async () => {
    await expect(addPatient(context(), { ...details, name: ' ' })).rejects.toThrow(z.ZodError);
    await expect(addPatient(context(), { ...details, phone: '123' })).rejects.toThrow(z.ZodError);
    expect(db.insertPatient).not.toHaveBeenCalled();
  });

  it('edits the details only, never the OP number or the centre', async () => {
    await editPatient(context(), {
      patientId,
      name: 'Test Patient',
      phone: '9900000002',
      sex: 'female',
      opNumber: 'KOR-99999',
      registeredCentreId: koramangala,
    });
    expect(db.updatePatient).toHaveBeenCalledWith(fakeTx, patientId, {
      name: 'Test Patient',
      phone: '+919900000002',
      sex: 'female',
    });
    db.updatePatient.mockResolvedValueOnce(false);
    await expect(editPatient(context(), { ...details, patientId })).rejects.toThrow(PatientError);
  });
});
