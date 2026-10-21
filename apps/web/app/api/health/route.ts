import { type HealthResponse, healthResponseSchema } from '@clinic-mx/schemas';

import { serverEnv } from '../../../lib/env';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const env = serverEnv();
  const body: HealthResponse = healthResponseSchema.parse({
    status: 'ok',
    commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    region: env.VERCEL_REGION ?? 'local',
    environment: env.VERCEL_ENV ?? 'local',
  });
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
