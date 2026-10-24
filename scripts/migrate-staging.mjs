// "Migrate staging" run from this machine (user decision 25 October 2026), while GitHub-hosted
// runners are unavailable: the same steps as .github/workflows/migrate-staging.yml, with the
// staging settings read from apps/web/.env.local. No shell is involved, so the database address
// is passed as it is and never printed. `pnpm migrate:staging` from main after a merge; see
// docs/runbooks/local-gate.md.
import { spawnSync } from 'node:child_process';

process.loadEnvFile('apps/web/.env.local');
const env = { ...process.env, CLINIC_MX_SEED_TARGET: 'staging' };
const missing = [
  'DIRECT_DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLINIC_MX_SEED_STAFF_PASSWORD',
].filter((name) => !env[name]);
if (missing.length > 0) {
  console.error(`apps/web/.env.local is missing ${missing.join(', ')}.`);
  process.exit(1);
}

const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
if (branch.stdout.trim() !== 'main') {
  console.error('Migrate staging from main, after the merge.');
  process.exit(1);
}

const run = (title, args, cwd = '.') => {
  console.log(`\n== ${title}`);
  const result = spawnSync(process.execPath, args, { env, cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const supabase = 'node_modules/supabase/dist/supabase.js';
const url = env.DIRECT_DATABASE_URL;
run('Apply migrations', [supabase, 'db', 'push', '--db-url', url, '--yes']);
run('List applied migrations', [supabase, 'migration', 'list', '--db-url', url]);
run('Seed', ['node_modules/tsx/dist/cli.mjs', 'src/seed/run.ts'], 'packages/db');
console.log('\nStaging migrated.');
