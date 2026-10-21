import { NextResponse } from 'next/server';
import { KIOSK_COOKIE } from '../../../../lib/session-cookies';
import { kioskBrowser, kioskState } from '../../../../modules/kiosk/device';

// What the clinic tablet's welcome screen asks every few seconds (IAM-10): wait, or open the form
// the front desk sent. A tablet that was stopped, or a cookie that names none, is told it has
// ended and its cookie is removed, so the browser is a normal browser again. Reads only; nothing
// here is audited.
export const dynamic = 'force-dynamic';

export async function GET() {
  const browser = await kioskBrowser();
  if (browser.status === 'active') {
    return NextResponse.json(await kioskState(browser.device), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const response = NextResponse.json(
    { state: 'ended' },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
  if (browser.status !== 'none') response.cookies.delete({ name: KIOSK_COOKIE, path: '/' });
  return response;
}
