import { createDb, runDueJobs } from '@clinic-mx/db';
import { serverEnv } from '../../../../lib/env';
import { jobHandlers } from '../../../../modules/jobs/handlers';
import { isAuthorisedTick } from '../../../../modules/jobs/tick-auth';

// The job tick (FND-10, TAD section 8): pg_cron POSTs here every minute with the jobs secret.
// Runs due jobs within the function's time limit; overlapping ticks take different jobs.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!isAuthorisedTick(request.headers.get('authorization'), env.JOBS_SECRET)) {
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
