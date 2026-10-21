import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { KioskError, resetKiosk, sendToKiosk, setUpKiosk, stopKiosk } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  withActor: vi.fn(),
  systemActor: (component: string) => `system:${component}`,
  clearKioskLink: vi.fn(),
  findKioskDevice: vi.fn(),
  hashKioskToken: (token: string) => `sha256(${token})`,
  insertKioskDevice: vi.fn(),
  newKioskToken: () => 'new-token',
  patientLinkState: vi.fn(),
  sendLinkToKiosk: vi.fn(),
  stopKioskDevice: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const kioskId = '00000000-0000-4000-8000-000000000701';
const linkId = '00000000-0000-4000-8000-000000000801';
const deskId = '00000000-0000-4000-8000-000000000203';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: deskId,
  email: 'desk@clinicmx.test',
  name: 'Test Front Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const context = (actor = member()) => ({ db: {} as Db, actor });

// IAM-10 done when: locked to patient pages; resets after a submit or 2 minutes idle. Staff with
// check in rights set tablets up in their centres, send forms to them and stop them.
describe('kiosk tablets', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) if (vi.isMockFunction(fn)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.withActor.mockImplementation((_db: Db, _actor: unknown, work: (tx: unknown) => unknown) =>
      work(fakeTx),
    );
    db.insertKioskDevice.mockResolvedValue({ id: kioskId });
    db.findKioskDevice.mockResolvedValue({ id: kioskId, centreId: hsr });
    db.patientLinkState.mockResolvedValue({ purpose: 'health_form', state: 'active' });
    db.sendLinkToKiosk.mockResolvedValue(true);
    db.stopKioskDevice.mockResolvedValue(true);
    db.clearKioskLink.mockResolvedValue(true);
  });

  describe('setting a tablet up', () => {
    it('keeps only the token’s hash and gives the token back for the cookie', async () => {
      expect(await setUpKiosk(context(), { centreId: hsr, name: ' Front desk tablet ' })).toEqual({
        kioskId,
        token: 'new-token',
      });
      expect(db.insertKioskDevice).toHaveBeenCalledWith(fakeTx, {
        centreId: hsr,
        name: 'Front desk tablet',
        createdBy: deskId,
        tokenHash: 'sha256(new-token)',
      });
    });

    it('is for check in rights in one’s own centres only', async () => {
      for (const role of ['physiotherapist', 'finance'] as const) {
        await expect(
          setUpKiosk(context(member({ role })), { centreId: hsr, name: 'Tablet' }),
        ).rejects.toThrow(NotAllowedError);
      }
      await expect(
        setUpKiosk(context(), { centreId: koramangala, name: 'Tablet' }),
      ).rejects.toThrow(NotAllowedError);
      await expect(
        setUpKiosk(context(member({ role: 'centre_manager' })), { centreId: hsr, name: 'Tablet' }),
      ).resolves.toBeDefined();
      expect(db.insertKioskDevice).toHaveBeenCalledTimes(1);
    });

    it('is refused to a read only support login, and without a name', async () => {
      const support = member({ role: 'super_admin', support: true, centreIds: [] });
      await expect(setUpKiosk(context(support), { centreId: hsr, name: 'Tablet' })).rejects.toThrow(
        ReadOnlyError,
      );
      await expect(setUpKiosk(context(), { centreId: hsr, name: ' ' })).rejects.toThrow(z.ZodError);
      expect(db.insertKioskDevice).not.toHaveBeenCalled();
    });
  });

  describe('sending a form', () => {
    it('puts a working single use form on the tablet', async () => {
      await sendToKiosk(context(), { kioskId, linkId });
      expect(db.sendLinkToKiosk).toHaveBeenCalledWith(fakeTx, kioskId, linkId);
    });

    it('refuses My plan, and a form that no longer works, in plain words', async () => {
      const cases = [
        [{ purpose: 'my_plan', state: 'active' }, 'My plan opens on the patient’s own phone'],
        [{ purpose: 'health_form', state: 'used' }, 'already sent that form'],
        [{ purpose: 'consent', state: 'expired' }, 'has expired'],
        [{ purpose: 'health_form', state: 'stopped' }, 'was stopped'],
        [undefined, 'was not found'],
      ] as const;
      for (const [state, words] of cases) {
        db.patientLinkState.mockResolvedValueOnce(state);
        await expect(sendToKiosk(context(), { kioskId, linkId })).rejects.toThrow(words);
      }
      expect(db.sendLinkToKiosk).not.toHaveBeenCalled();
    });

    it('refuses a stopped tablet, and one in another centre', async () => {
      db.sendLinkToKiosk.mockResolvedValueOnce(false);
      await expect(sendToKiosk(context(), { kioskId, linkId })).rejects.toThrow(
        'no longer a kiosk',
      );
      db.findKioskDevice.mockResolvedValueOnce({ id: kioskId, centreId: koramangala });
      await expect(sendToKiosk(context(), { kioskId, linkId })).rejects.toThrow(NotAllowedError);
      db.findKioskDevice.mockResolvedValueOnce(undefined);
      await expect(sendToKiosk(context(), { kioskId, linkId })).rejects.toThrow(KioskError);
    });
  });

  it('stops a tablet once', async () => {
    await stopKiosk(context(), { kioskId });
    expect(db.stopKioskDevice).toHaveBeenCalledWith(fakeTx, kioskId, deskId);
    db.stopKioskDevice.mockResolvedValueOnce(false);
    await expect(stopKiosk(context(), { kioskId })).rejects.toThrow('already stopped');
  });

  it('resets as the tablet itself, taking off only the form still on it', async () => {
    expect(await resetKiosk({} as Db, { kioskId, linkId })).toBe(true);
    expect(db.withActor).toHaveBeenCalledWith({}, `system:kiosk.${kioskId}`, expect.any(Function));
    expect(db.clearKioskLink).toHaveBeenCalledWith(fakeTx, kioskId, linkId);
    await expect(resetKiosk({} as Db, { kioskId: 'tablet', linkId })).rejects.toThrow(z.ZodError);
  });
});
