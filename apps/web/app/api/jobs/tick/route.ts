import { createDb, runDueJobs } from '@clinic-mx/db';
import { serverEnv } from '../../../../lib/env';
import { requestAddress } from '../../../../lib/network';
import { count, limited, networkKey } from '../../../../modules/rate-limits/limits';
import { jobHandlers } from '../../../../modules/jobs/handlers';
import { isAuthorisedTick } from '../../../../modules/jobs/tick-auth';

// The job tick (FND-10, TAD section 8): pg_cron POSTs here every minute with the jobs secret.
// Runs due jobs within the function's time limit; overlapping ticks take different jobs.
// IAM-11: calls with a wrong secret are limited per network; over the limit the secret is not
// even checked.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  if (!env.DATABASE_URL) {
    return Response.json({ error: 'Database not configured' }, { status: 503 });
  }
  const { db, close } = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const result = await runDueJobs(db, jobHandlers, { budgetMs: 40_000 });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } finally {
    await close();
  }
}
