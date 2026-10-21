import 'server-only';
import { findKioskByToken, findPatientLink, type KioskDeviceWithCentre } from '@clinic-mx/db';
import type { KioskState } from '@clinic-mx/schemas';
import { cookies } from 'next/headers';
import { appDb } from '../../lib/db';
import { KIOSK_COOKIE } from '../../lib/session-cookies';
import { patientLinkPath } from '../patient-links/services';

/**
 * The clinic tablet a browser is (IAM-10). Its cookie is its sign in: the token's hash finds the
 * tablet on the owner connection, as opening a patient link does (IAM-09).
 */
export type KioskBrowser =
  /** Not a kiosk: no cookie. */
  | { status: 'none' }
  /** A cookie that names no tablet. */
  | { status: 'unknown' }
  /** A tablet staff stopped. */
  | { status: 'stopped' }
  | { status: 'active'; device: KioskDeviceWithCentre };

export async function kioskBrowser(): Promise<KioskBrowser> {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (!token) return { status: 'none' };
  const device = await findKioskByToken(appDb(), token);
  if (!device) return { status: 'unknown' };
  if (device.stoppedAt) return { status: 'stopped' };
  return { status: 'active', device };
}

/** What the tablet's welcome screen should do: wait, or open the form sent to it. */
export async function kioskState(device: KioskDeviceWithCentre): Promise<KioskState> {
  if (!device.currentLinkId) return { state: 'waiting' };
  const link = await findPatientLink(appDb(), device.currentLinkId);
  const path = link ? patientLinkPath(link) : null;
  return path ? { state: 'open', path } : { state: 'waiting' };
}
