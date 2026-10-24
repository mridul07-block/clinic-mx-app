import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clinicalRecordOf } from './record';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  episodesOf: vi.fn(),
  signedNotesOf: vi.fn(),
  patientAlertHistory: vi.fn(),
  episodePlan: vi.fn(),
  episodePrecautions: vi.fn(),
  nextVisitOf: vi.fn(),
  logClinicalView: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaffViewing: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));

const patientId = '00000000-0000-4000-8000-000000000301';
const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
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
const episode = (id: string, status: string, centreId = hsr) => ({ id, status, centreId });
const note = (id: string, episodeId: string, centreId = hsr, signedBy = 'someone-else') => ({
  id,
  episodeId,
  centreId,
  signedBy,
  addenda: [],
});

// CLN-12 done when: the record shows the summary card, episodes, signed notes, documents and
// alerts; clinicians read it at any centre and each open is a record view.
describe('clinicalRecordOf', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.episodesOf.mockResolvedValue([
      episode('e2', 'active', koramangala),
      episode('e1', 'discharged'),
    ]);
    db.signedNotesOf.mockResolvedValue([note('c2', 'e2', koramangala), note('c1', 'e1')]);
    db.patientAlertHistory.mockResolvedValue([
      { id: 'a1', episodeId: 'e2', status: 'raised' },
      { id: 'a2', episodeId: 'e2', status: 'closed' },
      { id: 'a3', episodeId: 'e1', status: 'reviewed' },
    ]);
    db.episodePlan.mockResolvedValue({ version: 1 });
    db.episodePrecautions.mockResolvedValue([{ key: 'pregnancy', label: 'Pregnancy' }]);
    db.nextVisitOf.mockResolvedValue(undefined);
  });

  it('summarises the open episode and logs one record view', async () => {
    const now = new Date('2026-10-25T04:30:00Z');
    const record = await clinicalRecordOf(physio(), patientId, now);
    expect(record?.summary).toMatchObject({
      episode: { id: 'e2' },
      plan: { version: 1 },
      precautions: [{ key: 'pregnancy', label: 'Pregnancy' }],
      lastNote: { id: 'c2' },
      openAlerts: 1,
    });
    expect(db.episodePlan).toHaveBeenCalledWith(fakeTx, 'e2');
    expect(db.nextVisitOf).toHaveBeenCalledWith(fakeTx, patientId, now);
    expect(record?.alerts).toHaveLength(3);
    expect(db.logClinicalView).toHaveBeenCalledTimes(1);
    expect(db.logClinicalView).toHaveBeenCalledWith(fakeTx, 'patient', patientId);
  });

  it('offers addenda only at the centres the reader works at, with the tick', async () => {
    const notes = (await clinicalRecordOf(physio(), patientId))?.notes ?? [];
    expect(notes.map((n) => [n.id, n.addsAddenda])).toEqual([
      ['c2', false],
      ['c1', true],
    ]);
    // Their own note, wherever it was signed.
    db.signedNotesOf.mockResolvedValue([note('c3', 'e2', koramangala, physio().id)]);
    expect((await clinicalRecordOf(physio(), patientId))?.notes[0]?.addsAddenda).toBe(true);
    const admin = physio({ role: 'super_admin', treatsPatients: false, centreIds: [] });
    const adminNotes = (await clinicalRecordOf(admin, patientId))?.notes ?? [];
    expect(adminNotes.every((n) => !n.addsAddenda)).toBe(true);
  });

  it('gives no summary without episodes', async () => {
    db.episodesOf.mockResolvedValue([]);
    db.signedNotesOf.mockResolvedValue([]);
    expect((await clinicalRecordOf(physio(), patientId))?.summary).toBeUndefined();
  });

  it('is nothing, and logs nothing, for those who do not read clinical records', async () => {
    const desk = physio({ role: 'front_desk', treatsPatients: false });
    const support = physio({ role: 'super_admin', treatsPatients: false, support: true });
    const centreManager = physio({ role: 'centre_manager', treatsPatients: false });
    for (const reader of [desk, support, centreManager]) {
      expect(await clinicalRecordOf(reader, patientId), reader.role).toBeUndefined();
    }
    expect(db.episodesOf).not.toHaveBeenCalled();
    expect(db.logClinicalView).not.toHaveBeenCalled();
  });
});
