import { z } from 'zod';

/** Response of `GET /api/health`, read by uptime checks (FND-12). */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  /** Short git commit of the deployed build, or "local" outside Vercel. */
  commit: z.string().min(1),
  /** Vercel function region, for example "bom1"; "local" outside Vercel. */
  region: z.string().min(1),
  /** Vercel environment the build runs in; "local" outside Vercel. */
  environment: z.enum(['local', 'development', 'preview', 'production']),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
