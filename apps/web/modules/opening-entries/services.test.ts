import type { Db, StaffMember } from '@clinic-mx/db';
import { addDays, istDate } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import {
  correctOpeningEntryService,
  createOpeningEntry,
  OpeningEntryError,
  switchOpeningEntries,
} from './services';

const fakeTx = {
  kind: 'transaction',
  update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: () => [{ key: 'k' }] }) }) })),
};
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  centreList: vi.fn(),
  correctOpeningEntry: vi.fn(),
  insertEpisode: vi.fn(),
  insertOpeningEntry: vi.fn(),
  insertPatient: vi.fn(),
  openingEntries: vi.fn(),
  patientsOnPhone: vi.fn(),
  setting: { key: 'key' },
  staffActor: (id: string) => `staff:${id}`,
  treatingPhysios: vi.fn(),
  updateEpisodeState: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const settings = vi.hoisted(() => ({ open: true }));
vi.mock('../settings/settings', () => ({
  getSetting: () => Promise.resolve(settings.open),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const physioId = '00000000-0000-4000-8000-000000000208';
const entryId = '00000000-0000-4000-8000-000000000701';
const superAdmin: StaffMember = {
  id: '00000000-0000-4000-8000-000000000201',
  email: 'super.admin@clinicmx.test',
  name: 'Test Super Admin',
  role: 'super_admin',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
};
const manager: StaffMember = { ...superAdmin, role: 'centre_manager', centreIds: [hsr] };
const context = (actor: StaffMember) => ({ db: {} as Db, actor });
const validUntil = addDays(istDate(new Date()), 30);
const input = {
  name: 'Test Patient',
  phone: '9876543210',
  centreId: hsr,
  physioId,
  sessionsLeft: 6,
  validUntil,
};

// SCH-13 (user decisions 27 October 2026): the Super Admin only, while entries are open; a mobile
// on file lists its patients first; an Active episode; a correction until the package is used.
describe('opening entries', () => {
  beforeEach(() => {
    for (const fn of Object.values(db))
      if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
    settings.open = true;
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.treatingPhysios.mockResolvedValue([{ id: physioId, name: 'Test Physio' }]);
    db.patientsOnPhone.mockResolvedValue([]);
    db.insertPatient.mockResolvedValue({ id: 'patient-1', opNumber: 'HSR-00001' });
    db.insertEpisode.mockResolvedValue('episode-1');
    db.updateEpisodeState.mockResolvedValue(true);
    db.openingEntries.mockResolvedValue([{ id: entryId, centreId: hsr, sessionsUsed: 0 }]);
  });

  it('enters the patient, walks the episode to Active and records the entry', async () => {
    await expect(createOpeningEntry(context(superAdmin), input)).resolves.toEqual({
      status: 'added',
      patientId: 'patient-1',
      opNumber: 'HSR-00001',
    });
    expect(db.insertPatient).toHaveBeenCalledWith(fakeTx, {
      name: 'Test Patient',
      phone: '+919876543210',
      registeredCentreId: hsr,
    });
    const moves = db.updateEpisodeState.mock.calls as [
      unknown,
      string,
      string,
      { status: string },
    ][];
    expect(moves.map((call) => [call[2], call[3].status])).toEqual([
      ['intake_pending', 'awaiting_consultation'],
      ['awaiting_consultation', 'plan_proposed'],
      ['plan_proposed', 'active'],
    ]);
    expect(db.insertOpeningEntry).toHaveBeenCalledWith(fakeTx, {
      patientId: 'patient-1',
      episodeId: 'episode-1',
      centreId: hsr,
      physioId,
      sessionsLeft: 6,
      validUntil,
      by: superAdmin.id,
    });
  });

  it('lists a mobile on file first, and refuses closed entries, a physio elsewhere and others', async () => {
    db.patientsOnPhone.mockResolvedValueOnce([{ id: 'p', name: 'Test Other', opNumber: 'HSR-1' }]);
    expect((await createOpeningEntry(context(superAdmin), input)).status).toBe('matches');
    expect(db.insertPatient).not.toHaveBeenCalled();
    await expect(
      createOpeningEntry(context(superAdmin), { ...input, confirmNewPerson: true }),
    ).resolves.toMatchObject({ status: 'added' });

    db.treatingPhysios.mockResolvedValueOnce([]);
    await expect(createOpeningEntry(context(superAdmin), input)).rejects.toThrow(
      new OpeningEntryError('Choose a physio who treats patients at that centre.'),
    );
    settings.open = false;
    await expect(createOpeningEntry(context(superAdmin), input)).rejects.toThrow(
      'Opening entries are closed.',
    );
    await expect(createOpeningEntry(context(manager), input)).rejects.toThrow(NotAllowedError);
    await expect(
      createOpeningEntry(context({ ...superAdmin, support: true }), input),
    ).rejects.toThrow(ReadOnlyError);
  });

  it('corrects an entry until its package is used, and switches entries', async () => {
    const correct = () =>
      correctOpeningEntryService(context(superAdmin), {
        entryId,
        physioId,
        sessionsLeft: 4,
        validUntil,
      });
    await expect(correct()).resolves.toEqual({ status: 'corrected' });
    expect(db.correctOpeningEntry).toHaveBeenCalledWith(fakeTx, entryId, {
      physioId,
      sessionsLeft: 4,
      validUntil,
      by: superAdmin.id,
    });
    db.openingEntries.mockResolvedValueOnce([{ id: entryId, centreId: hsr, sessionsUsed: 1 }]);
    await expect(correct()).rejects.toThrow(
      'The opening package is in use; it is no longer corrected.',
    );
    await expect(switchOpeningEntries(context(superAdmin), { open: false })).resolves.toEqual({
      open: false,
    });
    await expect(switchOpeningEntries(context(manager), { open: false })).rejects.toThrow(
      NotAllowedError,
    );
  });
});
