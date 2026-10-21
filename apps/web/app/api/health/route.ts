import { type HealthResponse, healthResponseSchema } from '@clinic-mx/schemas';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const body: HealthResponse = healthResponseSchema.parse({
    status: 'ok',
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    region: process.env.VERCEL_REGION ?? 'local',
  });
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
