import { signLiveToken } from '@clinic-mx/live-relay/token';
import { serverEnv } from '../../../../../../lib/env';
import { currentStaff } from '../../../../../../modules/auth/session';
import { switchableCentres } from '../../../../../../modules/navigation/centres';

// A ticket to the realtime relay (FND-09; docs/runbooks/live-relay.md): its address and a token
// for a minute, naming the signed in person and the centres they see, so the relay pings them only
// about those. 204 where the relay is not set up. Asked with the live header, so it is never
// activity for the idle sign out.
export const dynamic = 'force-dynamic';

const TICKET_MS = 60_000;

export async function GET() {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: 'Sign in again.' }, { status: 401 });
  const { LIVE_RELAY_URL: url, LIVE_RELAY_TOKEN_SECRET: secret } = serverEnv();
  if (!url || !secret) return new Response(null, { status: 204 });
  const centres = (await switchableCentres(staff)).map((centre) => centre.id);
  const token = await signLiveToken(
    { staffId: staff.id, centres, expiresAt: Date.now() + TICKET_MS },
    secret,
  );
  return Response.json({ url, token }, { headers: { 'Cache-Control': 'no-store' } });
}
