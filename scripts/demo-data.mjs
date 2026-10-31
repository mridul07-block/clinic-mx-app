// `pnpm demo:fill` and `pnpm demo:remove` (docs/runbooks/demo-data.md): generated demo patients on
// the local stack or staging, so every screen has something on it, and taken away again.
// `--target local` (the default) uses the local stack; `--target staging` reads the staging
// settings from apps/web/.env.local and runs from main only, as `pnpm migrate:staging` does. The
// database address is passed as it is and never printed.
import { spawnSync } from 'node:child_process';

const [action, ...rest] = process.argv.slice(2);
if (action !== 'fill' && action !== 'remove') {
  console.error('Usage: node scripts/demo-data.mjs fill|remove [--target local|staging]');
  process.exit(1);
}
const at = rest.indexOf('--target');
const target = at === -1 ? 'local' : rest[at + 1];
if (target !== 'local' && target !== 'staging') {
  console.error('--target is local or staging.');
  process.exit(1);
}

let env;
if (target === 'staging') {
  process.loadEnvFile('apps/web/.env.local');
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  if (branch.stdout.trim() !== 'main') {
    console.error('Fill or remove staging demo data from main, after the merge.');
    process.exit(1);
  }
  env = { ...process.env, CLINIC_MX_SEED_TARGET: 'staging' };
} else {
  const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  env = { ...process.env, CLINIC_MX_SEED_TARGET: 'local', DIRECT_DATABASE_URL: local };
}

const result = spawnSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'src/demo/run.ts', action],
  { env, cwd: 'packages/db', stdio: 'inherit' },
);
process.exit(result.status ?? 1);
