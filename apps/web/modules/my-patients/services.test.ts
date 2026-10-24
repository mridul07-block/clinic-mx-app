import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { SchedulingError } from '../scheduling/services';
import { loadMyPatients, startVisit } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  appointmentRecord: vi.fn(),
  startVisit: vi.fn(),
  myPatientsToday: vi.fn(),
  contentVersion: vi.fn(() => 'v1'),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));
vi.mock('../settings/settings', () => ({ getSetting: vi.fn(() => Promise.resolve(1)) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const appointmentId = '00000000-0000-4000-8000-000000000901';
const physio = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000204',
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
const visit = (extra: Record<string, unknown> = {}) => ({
  id: appointmentId,
  centreId: hsr,
  physioId: physio().id,
  status: 'checked_in',
  startsAt: new Date(),
  ...extra,
});

// CLN-01: a treating physio's own visits today; Start marks their checked in visit In progress.
describe('my patients today', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.contentVersion.mockReturnValue('v1');
    db.startVisit.mockResolvedValue({ id: appointmentId });
  });

  it('lists the person’s own visits today, for those with the Treats patients tick', async () => {
    db.myPatientsToday.mockResolvedValue([]);
    const view = await loadMyPatients(physio());
    expect(view.version).toBe('v1');
    expect(db.myPatientsToday).toHaveBeenCalledWith(fakeTx, {
      staffId: physio().id,
      date: view.date,
    });
    await expect(loadMyPatients(physio({ treatsPatients: false }))).rejects.toThrow(
      NotAllowedError,
    );
    await expect(
      loadMyPatients(physio({ role: 'front_desk', treatsPatients: false })),
    ).rejects.toThrow(NotAllowedError);
  });

  it('starts the physio’s own checked in visit, as them', async () => {
    db.appointmentRecord.mockResolvedValue(visit());
    await startVisit(context(), { appointmentId });
    expect(db.startVisit).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ appointmentId, by: physio().id }),
    );
  });

  it('refuses someone else’s visit, one not checked in, one started, and another day', async () => {
    const refused = async (found: Record<string, unknown>, message: string) => {
      db.appointmentRecord.mockResolvedValue(visit(found));
      await expect(startVisit(context(), { appointmentId })).rejects.toThrow(message);
    };
    await refused(
      { physioId: 'someone-else' },
      'Only the physio of this appointment can start it.',
    );
    await refused({ status: 'booked' }, 'Check the patient in first.');
    await refused({ status: 'in_progress' }, 'This visit has started already.');
    await refused(
      { startsAt: new Date(Date.now() - 2 * 24 * 3600_000) },
      'A visit is started on its own day.',
    );
    db.appointmentRecord.mockResolvedValue(undefined);
    await expect(startVisit(context(), { appointmentId })).rejects.toThrow(SchedulingError);
    expect(db.startVisit).not.toHaveBeenCalled();
  });

  it('refuses those without the tick, and Velyx support, who only reads', async () => {
    await expect(
      startVisit(context(physio({ treatsPatients: false })), { appointmentId }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      startVisit(context(physio({ role: 'super_admin', support: true })), { appointmentId }),
    ).rejects.toThrow(ReadOnlyError);
  });
});
