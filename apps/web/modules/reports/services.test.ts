import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportFile, reportsOfPatient } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({ patientReports: vi.fn(), reportFileOf: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));
vi.mock('../front-desk/report-store', () => ({ reportStore: () => store }));
const store = { put: vi.fn(), remove: vi.fn(), get: vi.fn() };

const reportId = '00000000-0000-4000-8000-000000000801';
const patientId = '00000000-0000-4000-8000-000000000301';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000204',
  email: 'physio@clinicmx.test',
  name: 'Test Physio',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: false,
  centreIds: ['00000000-0000-4000-8000-000000000102'],
  support: false,
  ...extra,
});

// ALT-08: report photos and scans open for clinicians only (clinical.read), at any centre.
describe('opening reports', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), ...Object.values(store)]) fn.mockReset();
    db.reportFileOf.mockResolvedValue({ filePath: 'p/r.jpg', contentType: 'image/jpeg' });
    db.patientReports.mockResolvedValue([{ id: reportId }]);
    store.get.mockResolvedValue(new Uint8Array([0xff, 0xd8]));
  });

  it('gives a clinician the list and the file', async () => {
    expect(await reportsOfPatient(member(), patientId)).toEqual([{ id: reportId }]);
    expect(await reportFile(member(), reportId)).toEqual({
      bytes: new Uint8Array([0xff, 0xd8]),
      contentType: 'image/jpeg',
    });
    expect(store.get).toHaveBeenCalledWith('p/r.jpg');
    // The Super Admin reads clinical records without the tick (PRD section 2).
    expect(
      await reportFile(member({ role: 'super_admin', treatsPatients: false }), reportId),
    ).toBeDefined();
  });

  it('gives everyone else nothing, and never touches the bucket', async () => {
    for (const actor of [
      member({ role: 'front_desk', treatsPatients: false }),
      member({ role: 'finance', treatsPatients: false }),
      member({ role: 'centre_manager', treatsPatients: false }),
      member({ role: 'super_admin', treatsPatients: false, support: true }),
    ]) {
      expect(await reportsOfPatient(actor, patientId), actor.role).toEqual([]);
      expect(await reportFile(actor, reportId), actor.role).toBeUndefined();
    }
    expect(db.reportFileOf).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
  });

  it('says not found for a report the clinician cannot read', async () => {
    db.reportFileOf.mockResolvedValue(undefined);
    expect(await reportFile(member(), reportId)).toBeUndefined();
    expect(store.get).not.toHaveBeenCalled();
  });
});
