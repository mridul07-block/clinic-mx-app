import { deviceClass, type DeviceClass } from '@clinic-mx/schemas';

/**
 * Cookies for the session rules (IAM-07). The device class is decided at sign in (G7), and a
 * desktop's last activity is kept by the server. Neither is readable by page scripts.
 */
export const DEVICE_COOKIE = 'clinic_device';
export const LAST_SEEN_COOKIE = 'clinic_last_seen';

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  // As long as a browser keeps a cookie; the session rules decide when the session ends.
  maxAge: 400 * 24 * 60 * 60,
} as const;

export const readDevice = (value: string | undefined): DeviceClass => deviceClass(value);

/** A last activity time from its cookie, or undefined when missing or not a time. */
export function readLastSeen(value: string | undefined): Date | undefined {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : undefined;
}

/**
 * A clinic tablet in kiosk mode (IAM-10): a random token whose sha256 names the tablet. While a
 * browser holds it, it opens only the kiosk and the form sent to it (proxy.ts, /p/[token]).
 */
export const KIOSK_COOKIE = 'clinic_kiosk';
