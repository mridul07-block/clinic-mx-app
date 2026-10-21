import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kioskBrowser, kioskState } from './device';

const db = vi.hoisted(() => ({ findKioskByToken: vi.fn(), findPatientLink: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'clinic_kiosk' && jar.value ? { name, value: jar.value } : undefined,
    }),
}));
const links = vi.hoisted(() => ({ patientLinkPath: vi.fn() }));
vi.mock('../patient-links/services', () => links);

const device = {
  id: '00000000-0000-4000-8000-000000000701',
  centreId: '00000000-0000-4000-8000-000000000101',
  centreName: 'HSR Layout',
  stoppedAt: null,
  currentLinkId: null,
};
const linkId = '00000000-0000-4000-8000-000000000801';

// IAM-10: a browser is a clinic tablet only while its cookie names a working tablet.
describe('the kiosk browser', () => {
  beforeEach(() => {
    jar.value = undefined;
    db.findKioskByToken.mockReset();
    db.findPatientLink.mockReset();
    links.patientLinkPath.mockReset();
  });

  it('is no kiosk without the cookie, and asks the database nothing', async () => {
    expect(await kioskBrowser()).toEqual({ status: 'none' });
    expect(db.findKioskByToken).not.toHaveBeenCalled();
  });

  it('finds the tablet by its token; unknown and stopped tablets are not kiosks', async () => {
    jar.value = 'token';
    db.findKioskByToken.mockResolvedValueOnce(device);
    expect(await kioskBrowser()).toEqual({ status: 'active', device });
    expect(db.findKioskByToken).toHaveBeenCalledWith({ kind: 'appDb' }, 'token');
    db.findKioskByToken.mockResolvedValueOnce(undefined);
    expect(await kioskBrowser()).toEqual({ status: 'unknown' });
    db.findKioskByToken.mockResolvedValueOnce({ ...device, stoppedAt: new Date() });
    expect(await kioskBrowser()).toEqual({ status: 'stopped' });
  });

  it('waits until a form is sent, then opens it', async () => {
    expect(await kioskState(device as never)).toEqual({ state: 'waiting' });
    const link = { id: linkId, purpose: 'health_form', expiresAt: new Date() };
    db.findPatientLink.mockResolvedValue(link);
    links.patientLinkPath.mockReturnValue('/p/signed');
    expect(await kioskState({ ...device, currentLinkId: linkId } as never)).toEqual({
      state: 'open',
      path: '/p/signed',
    });
    expect(links.patientLinkPath).toHaveBeenCalledWith(link);
    links.patientLinkPath.mockReturnValue(null);
    expect(await kioskState({ ...device, currentLinkId: linkId } as never)).toEqual({
      state: 'waiting',
    });
  });
});
