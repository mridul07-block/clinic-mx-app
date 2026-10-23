import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { AlertError, closeAlert, emergencyBannersOf, referAlert, reviewAlert } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  alertForUpdate: vi.fn(),
  moveRedFlagAlert: vi.fn(),
  episodeRecord: vi.fn(),
  updateEpisodeState: vi.fn(),
  openEmergencies: vi.fn(),
  openRedFlagAlerts: vi.fn(),
  recentlyClosedAlerts: vi.fn(),
  redFlagAlertsByIds: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const alertId = '00000000-0000-4000-8000-000000000701';
const episodeId = '00000000-0000-4000-8000-000000000501';
const appointmentId = '00000000-0000-4000-8000-000000000601';
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
const alert = (status: string, centreId = hsr) => ({ id: alertId, status, episodeId, centreId });

// ALT-01: clinicians move an alert raised, reviewed, referred, closed; refer holds the episode.
describe('red flag alerts', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.moveRedFlagAlert.mockResolvedValue(true);
    db.updateEpisodeState.mockResolvedValue(true);
  });

  it('lets a clinician say "I’m reviewing", as themselves', async () => {
    db.alertForUpdate.mockResolvedValue(alert('raised'));
    await reviewAlert(context(), { alertId });
    expect(db.moveRedFlagAlert).toHaveBeenCalledWith(fakeTx, alertId, 'raised', {
      status: 'reviewed',
      reviewedBy: physio().id,
    });
  });

  it('refuses a move the lifecycle does not allow, and one that lost a race', async () => {
    db.alertForUpdate.mockResolvedValue(alert('raised'));
    await expect(closeAlert(context(), { alertId, decision: 'Seen.' })).rejects.toThrow(
      'Press “I’m reviewing” before referring or closing.',
    );
    db.alertForUpdate.mockResolvedValue(alert('closed'));
    await expect(reviewAlert(context(), { alertId })).rejects.toThrow(AlertError);
    db.alertForUpdate.mockResolvedValue(alert('raised'));
    db.moveRedFlagAlert.mockResolvedValue(false);
    await expect(reviewAlert(context(), { alertId })).rejects.toThrow(
      'The alert changed meanwhile. Reload and try again.',
    );
    db.alertForUpdate.mockResolvedValue(undefined);
    await expect(reviewAlert(context(), { alertId })).rejects.toThrow('That alert was not found.');
  });

  it('refers, putting the episode On hold unless it already is', async () => {
    db.alertForUpdate.mockResolvedValue(alert('reviewed'));
    db.episodeRecord.mockResolvedValue({ id: episodeId, status: 'awaiting_consultation' });
    await referAlert(context(), { alertId, referredTo: ' Emergency department ' });
    expect(db.moveRedFlagAlert).toHaveBeenCalledWith(fakeTx, alertId, 'reviewed', {
      status: 'referred',
      referredBy: physio().id,
      referredTo: 'Emergency department',
    });
    expect(db.updateEpisodeState).toHaveBeenCalledWith(
      fakeTx,
      episodeId,
      'awaiting_consultation',
      expect.objectContaining({ status: 'on_hold', pausedFrom: 'awaiting_consultation' }),
      undefined,
    );

    db.updateEpisodeState.mockClear();
    db.episodeRecord.mockResolvedValue({
      id: episodeId,
      status: 'on_hold',
      pausedFrom: 'awaiting_consultation',
    });
    await referAlert(context(), { alertId, referredTo: 'Doctor' });
    expect(db.updateEpisodeState).not.toHaveBeenCalled();
  });

  it('closes with the written decision', async () => {
    db.alertForUpdate.mockResolvedValue(alert('referred'));
    await closeAlert(context(), { alertId, decision: 'Sent to the emergency department.' });
    expect(db.moveRedFlagAlert).toHaveBeenCalledWith(fakeTx, alertId, 'referred', {
      status: 'closed',
      closedBy: physio().id,
      decision: 'Sent to the emergency department.',
    });
    await expect(closeAlert(context(), { alertId, decision: '  ' })).rejects.toThrow(
      'Write the decision before closing.',
    );
  });

  it('lets only clinicians at the alert’s centre act', async () => {
    db.alertForUpdate.mockResolvedValue(alert('raised'));
    const manager = physio({ role: 'centre_manager', treatsPatients: false });
    for (const actor of [manager, physio({ role: 'front_desk', treatsPatients: false })]) {
      await expect(reviewAlert(context(actor), { alertId })).rejects.toThrow(NotAllowedError);
    }
    db.alertForUpdate.mockResolvedValue(alert('raised', koramangala));
    await expect(reviewAlert(context(), { alertId })).rejects.toThrow(NotAllowedError);
    await expect(
      reviewAlert(context(physio({ role: 'super_admin', support: true })), { alertId }),
    ).rejects.toThrow(ReadOnlyError);
    expect(db.moveRedFlagAlert).not.toHaveBeenCalled();
  });

  it('shows the front desk the patient only, and clinicians the rule with the action', async () => {
    const raisedAt = new Date('2026-10-23T05:00:00Z');
    db.openEmergencies.mockResolvedValue([
      {
        alertId,
        episodeId,
        appointmentId,
        patientId: 'p',
        patientName: 'Test Patient',
        centreId: hsr,
        startsAt: new Date('2026-10-23T04:45:00Z'),
        raisedAt,
      },
    ]);
    db.redFlagAlertsByIds.mockResolvedValue([
      { id: alertId, name: 'Possible cauda equina', signedOff: false },
    ]);
    const desk = await emergencyBannersOf(physio({ role: 'front_desk', treatsPatients: false }));
    expect(desk).toEqual([
      {
        alertId,
        patientName: 'Test Patient',
        raisedAt,
        visitHref: expect.stringContaining(appointmentId) as unknown,
        clinical: undefined,
      },
    ]);
    expect(db.redFlagAlertsByIds).not.toHaveBeenCalled();
    const [mine] = await emergencyBannersOf(physio());
    expect(mine?.clinical).toEqual({
      name: 'Possible cauda equina',
      signedOff: false,
      canAct: true,
    });
    const [managers] = await emergencyBannersOf(
      physio({ role: 'centre_manager', treatsPatients: false }),
    );
    expect(managers?.clinical?.canAct).toBe(false);
    for (const actor of [
      physio({ role: 'finance', treatsPatients: false }),
      physio({ role: 'super_admin', support: true }),
    ]) {
      expect(await emergencyBannersOf(actor)).toEqual([]);
    }
  });
});
