import { randomBytes, randomInt } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { serverEnv } from '../../../../lib/env';
import { requestAddress } from '../../../../lib/network';
import { isAuthorisedTick } from '../../../../modules/jobs/tick-auth';
import { count, limited, networkKey } from '../../../../modules/rate-limits/limits';

/** How long the check waits for Sentry to take the report. */
const FLUSH_MS = 5000;

/** The test error; its own name, so the alert email says what it is. */
class MonitoringCheckError extends Error {
  override name = 'MonitoringCheckError';
}

const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join('');

/** Fresh fake details each time, never a real patient's: the report must hold none of them. */
function plantedDetails() {
  return {
    name: `Test Check ${digits(4)}`,
    phone: `+91 9${digits(9)}`,
    patientNumber: `MVH-${digits(8)}`,
    email: `check.${digits(6)}@example.com`,
    token: randomBytes(24).toString('base64url'),
  };
}

// The monitoring drill (FND-12, docs/runbooks/monitoring.md): POST with the jobs secret. Reports
// a test error carrying generated fake patient details, so ops can see the alert reach the on call
// phone and check the stored report holds none of them. Limited per network like the job tick.
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  const network = networkKey(requestAddress(request.headers));
  const over = await limited('webhook_failures_per_network', network);
  if (over.limited) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(over.retryAfterSeconds) } },
    );
  }
  if (!isAuthorisedTick(request.headers.get('authorization'), env.JOBS_SECRET)) {
    await count('webhook_failures_per_network', network);
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const planted = plantedDetails();
  // A name in free text cannot be told from other words, so code never writes one into an error;
  // values do reach errors quoted (Postgres, Drizzle), which is how the name is planted here.
  const eventId = Sentry.captureException(
    new MonitoringCheckError(
      `Monitoring check for "${planted.name}", phone ${planted.phone}, patient ` +
        `${planted.patientNumber}, email ${planted.email}, link /p/${planted.token}`,
    ),
  );
  const sent = await Sentry.flush(FLUSH_MS);
  return Response.json(
    { eventId, sent, configured: Boolean(env.SENTRY_DSN), planted: Object.values(planted) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
