import { z } from 'zod';

/**
 * Server environment variables, validated in one place (rule 13: secrets only in the
 * environment). Later tickets add their variables here; `.env.example` lists them all.
 * Read on each call so tests can stub `process.env`.
 */
const serverEnvSchema = z.object({
  /** Set by Vercel: "production", "preview" or "development". Absent locally. */
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
  /** Set by Vercel: the function region, for example "bom1". */
  VERCEL_REGION: z.string().min(1).optional(),
  /** Set by Vercel: the git commit of the deployment. */
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).optional(),
  /** Supabase transaction pooler (port 6543) for the app at runtime. */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  /** Supabase API, called only from the server (rule 9), for example https://<ref>.supabase.co. */
  SUPABASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** The anon (public) key; the server uses it for Supabase Auth on behalf of staff. */
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  /**
   * The service role key, for the few admin actions only the server makes (IAM-06: the Super
   * Admin inviting staff and resetting two step verification). Never sent to the browser.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Sent by pg_cron with every job tick (FND-10); at least 32 characters. */
  JOBS_SECRET: z.string().min(32).optional(),
  /** Signs patient links (IAM-09); at least 32 random characters. Without it no link opens. */
  PATIENT_LINK_SECRET: z.string().min(32).optional(),
  /** The key before PATIENT_LINK_SECRET while it rotates: its links keep working until they end. */
  PATIENT_LINK_SECRET_PREVIOUS: z.string().min(32).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function serverEnv(): ServerEnv {
  // Empty strings count as unset, so an emptied Vercel variable fails safe.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
  );
  return serverEnvSchema.parse(raw);
}
