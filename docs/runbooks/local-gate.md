# Local gate

GitHub Actions stopped starting jobs on 24 October 2026 ("recent account payments have failed or
your spending limit needs to be increased"). Decision (user, 25 October 2026): keep the repository
private and run the same checks on a developer machine until a runner is available again; CI runs
only on pull requests from now on, so the free minutes go twice as far when they return. A
self-hosted runner on a developer machine (no charge from GitHub) is the next step once the laptop
has 16 GB.

## Before every merge: `pnpm ci:local`

From the repository root on the branch, with Docker running and nothing on port 3000
(`scripts/ci-local.sh`). It runs every job of `.github/workflows/ci.yml`, in order, and stops at
the first failure:

| Step | CI job |
| --- | --- |
| `pnpm verify` (format, lint, design check, typecheck, unit tests) | Format, lint, typecheck, unit tests |
| Migrations match the schema; migrations are forward only against `origin/main` | Same job |
| Local database reset and every migration applied to it; seed; knowledge base import | Local Supabase stack |
| Database tests | Local Supabase stack |
| End to end, phone then desktop (`CI=1`: a fresh build, one retry, as on CI) | End to end (phone), (desktop) |
| Secret scan of the whole history (the gitleaks 8.30.1 release binary, checked against a pinned hash) | Secret scan |

It ends with "Local gate passed at <commit>". The pull request notes that it passed locally, with
the commit; a merge waits for that line, as it waited for green CI. It resets the local database
(the seed and the knowledge base import put back what the tests need) and changes the local staff
password unless `CLINIC_MX_SEED_STAFF_PASSWORD` is set.

The run takes about 30 to 40 minutes on the current laptop; the two end to end projects run one
after the other to stay within 8 GB.

## After a merge: `pnpm migrate:staging`

From `main`, after `git pull` (`scripts/migrate-staging.mjs`): the steps of
`.github/workflows/migrate-staging.yml` (apply new migrations, list them, seed) with the staging
settings from `apps/web/.env.local`. Nothing goes through a shell and the database address is
never printed. Vercel still deploys on its own; check `/api/health` serves the merge commit.

## Backups

The nightly backup also runs on GitHub Actions and is paused with it. Until runners are back, take
one by hand after each staging change, as `docs/runbooks/backups.md` describes (`pnpm backup …`
with the staging settings and `BACKUP_AGE_RECIPIENT`).

## When GitHub Actions works again

CI runs on each pull request as before (and by hand from the Actions tab with "Run workflow");
"Migrate staging" and the backup run on their own again. Keep `pnpm ci:local` for when a run is
unavailable.
