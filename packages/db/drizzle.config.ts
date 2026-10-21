import { defineConfig } from 'drizzle-kit';

// Migrations go to supabase/migrations with timestamp names, so the Supabase CLI applies them
// (`supabase start`, `supabase db push`). Generating needs no database connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: '../../supabase/migrations',
  migrations: { prefix: 'supabase' },
  strict: true,
  verbose: true,
});
