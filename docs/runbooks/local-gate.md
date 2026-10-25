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

The run takes about 10 to 14 minutes on the current laptop; the two end to end projects run one
after the other to stay within 8 GB.

## Time of day

The gate runs at any hour, midnight IST included. The database checks visits in, starts them and
undoes either on their own IST day only, so a test visit placed "50 minutes ago" at 00:20 IST
would be yesterday's and its test would fail.

- **The rule:** test visits start with `earlierToday(minutes)` (`packages/schemas/src/ist.ts`). It
  is `minutes` before now on today's IST date, or as long after it when that would cross
  midnight. `startedAppointment` (`apps/web/e2e/calendar.ts`) and the database fixtures use it.
- **Enforced:** lint refuses `startsAt` from `Date.now()` plus or minus a number in tests
  (`eslint.config.mjs`). A deliberate other day takes a disable comment saying why.
- **What still skips near midnight,** because it needs a start in the past or late in the day by
  design:
  - the no show undo (`no-show.spec.ts`)
  - Running late on My patients, in the 20 minutes after midnight and the 30 before it
  - Today's coming visit after 22:00 IST (`today.spec.ts`)
  - walk-in after 22:40 IST (`walk-in.spec.ts`)

  These skip; they never fail.

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
