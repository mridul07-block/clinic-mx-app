/**
 * Clinic Mx database: Drizzle schema, the client, and seed data. Migrations are generated
 * from the schema into `supabase/migrations` (`pnpm db:generate`); see
 * docs/runbooks/supabase.md.
 */
export * from './schema';
export { createDb, type Db } from './client';
