import { NextResponse } from 'next/server';
import { KIOSK_COOKIE } from '../../../../lib/session-cookies';
import { requestAddress } from '../../../../lib/network';
import { kioskBrowser, kioskState } from '../../../../modules/kiosk/device';
import { count, networkKey } from '../../../../modules/rate-limits/limits';

// What the clinic tablet's welcome screen asks every few seconds (IAM-10): wait, or open the form
// the front desk sent. A tablet that was stopped, or a cookie that names none, is told it has
// ended and its cookie is removed, so the browser is a normal browser again. Reads only; nothing
// here is audited. A cookie that names no tablet is a guessed credential: it counts against the
// network's bad links (IAM-11), which the patient pages enforce.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const browser = await kioskBrowser();
  if (browser.status === 'unknown') {
    await count('bad_links_per_network', networkKey(requestAddress(request.headers)));
  }
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
