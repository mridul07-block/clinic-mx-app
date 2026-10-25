import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { loadSession } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  sessionVisit: vi.fn(),
  sessionProgress: vi.fn(),
  episodeRecord: vi.fn(),
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

const hsr = '00000000-0000-4000-8000-000000000101';
const appointmentId = '00000000-0000-4000-8000-000000000901';
const patientId = '00000000-0000-4000-8000-000000000301';
const episodeId = '00000000-0000-4000-8000-000000000501';
const staff = (extra: Partial<StaffMember> = {}): StaffMember => ({
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
const otherPhysio = staff({ id: '00000000-0000-4000-8000-000000000205' });
const superAdmin = staff({
  id: '00000000-0000-4000-8000-000000000201',
  role: 'super_admin',
  treatsPatients: false,
  centreIds: [],
});
const visit = (extra: Record<string, unknown> = {}) => ({
  id: appointmentId,
  physioId: staff().id,
  physioName: 'Test Physio',
  status: 'in_progress',
  startsAt: new Date(),
  episodeId,
  typeKey: 'session',
  typeName: 'Session',
  patientId,
  ...extra,
});

// SES-02 done when: the physio who starts a session sees the summary card of its episode, from the
// signed plan, with no AI sheet; only they open it, and the Super Admin reads it.
describe('loadSession', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.sessionVisit.mockResolvedValue(visit());
    db.sessionProgress.mockResolvedValue(
      new Map([[appointmentId, { number: 3, planned: 12, episodeStatus: 'active' }]]),
    );
    db.episodeRecord.mockResolvedValue({ id: episodeId, status: 'active', centreId: hsr });
    db.signedNotesOf.mockResolvedValue([
      { id: 'c1', episodeId, centreId: hsr, signedBy: 'consultant', addenda: [] },
      { id: 'c0', episodeId: 'older', centreId: hsr, signedBy: 'consultant', addenda: [] },
    ]);
    db.patientAlertHistory.mockResolvedValue([
      { id: 'a1', episodeId, status: 'raised' },
      { id: 'a2', episodeId: 'older', status: 'raised' },
    ]);
    db.episodePlan.mockResolvedValue({ version: 1, sessionsPerWeek: 2, weeks: 6 });
    db.episodePrecautions.mockResolvedValue([{ key: 'pregnancy', label: 'Pregnancy' }]);
    db.nextVisitOf.mockResolvedValue(undefined);
  });

  it('gives the own physio the card of the session’s episode, and logs the view', async () => {
    const screen = await loadSession(staff(), appointmentId);
    expect(screen?.readOnly).toBe(false);
    expect(screen?.session.label).toBe('Session 3 of 12');
    expect(db.episodeRecord).toHaveBeenCalledWith(fakeTx, episodeId);
    expect(db.episodePlan).toHaveBeenCalledWith(fakeTx, episodeId);
    expect(screen?.summary).toMatchObject({
      plan: { sessionsPerWeek: 2, weeks: 6 },
      precautions: [{ key: 'pregnancy', label: 'Pregnancy' }],
      lastNote: { id: 'c1' },
      openAlerts: 1,
    });
    expect(db.logClinicalView).toHaveBeenCalledWith(fakeTx, 'patient', patientId);
  });

  it('refuses another physio and Velyx support; the Super Admin reads it', async () => {
    await expect(loadSession(otherPhysio, appointmentId)).rejects.toThrow(NotAllowedError);
    await expect(loadSession(staff({ support: true }), appointmentId)).rejects.toThrow(
      NotAllowedError,
    );
    await expect(
      loadSession(staff({ role: 'front_desk', treatsPatients: false }), appointmentId),
    ).rejects.toThrow(NotAllowedError);
    expect(db.logClinicalView).not.toHaveBeenCalled();
    const screen = await loadSession(superAdmin, appointmentId);
    expect(screen?.readOnly).toBe(true);
    expect(db.logClinicalView).toHaveBeenCalledOnce();
  });

  it('is not found for a missing appointment or one that is not a session', async () => {
    db.sessionVisit.mockResolvedValueOnce(undefined);
    await expect(loadSession(staff(), appointmentId)).resolves.toBeUndefined();
    db.sessionVisit.mockResolvedValueOnce(visit({ typeKey: 'consultation' }));
    db.sessionProgress.mockResolvedValueOnce(new Map());
    await expect(loadSession(staff(), appointmentId)).resolves.toBeUndefined();
    expect(db.logClinicalView).not.toHaveBeenCalled();
  });

  it('shows no card for a session outside an episode', async () => {
    db.sessionVisit.mockResolvedValueOnce(visit({ episodeId: null }));
    db.sessionProgress.mockResolvedValueOnce(
      new Map([[appointmentId, { number: null, planned: null, episodeStatus: null }]]),
    );
    const screen = await loadSession(staff(), appointmentId);
    expect(screen?.summary).toBeUndefined();
    expect(screen?.session.gate.message).toBe('Not part of an episode yet.');
    expect(db.episodeRecord).not.toHaveBeenCalled();
  });
});
