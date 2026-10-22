# Checks: what runs where, and how long it takes

The quality bar is the same for every change: CI runs every check, the full end to end suite
included, and nothing merges until **every CI job** has passed. The aim here is to reach that bar
quickly. Decision (user, 22 October 2026): faster checks, without dropping any test.

## On the development machine, before pushing

| Step | Command | About |
| --- | --- | --- |
| Format, lint, typecheck, unit tests, design check, run side by side | `pnpm verify` | 50 s |
| Database tests (migrations, RLS by role, audit) | `pnpm --filter @clinic-mx/db test:integration` | 20 s |
| End to end tests for the area changed, at 360 px and desktop | `pnpm test:e2e e2e/<area>.spec.ts …` | 1 to 2 min |

- **Which end to end specs to run.** The specs of the screens the change touches, plus any spec
  whose helpers changed: `e2e/*.ts` without `.spec`, or a shared component such as `forms.tsx`.
  The spec files are named by area: `patients`, `centres` and so on.
- **When to run the full suite locally instead.** For a change that cuts across many screens:
  sign in, sessions, the proxy, layout or design tokens.
- **Why Playwright's `--only-changed` does not pick them.** It follows imports, and our end to
  end tests drive the app through the browser rather than importing its code.

## In CI (`.github/workflows/ci.yml`), on every pull request and on main

These jobs all start together:

| Job | What it runs | About |
| --- | --- | --- |
| Format, lint, typecheck, unit tests | Also the design check and both migration checks | 2 min |
| Local Supabase stack | Every migration on an empty database, the seed, the database tests | 2 to 3 min |
| End to end (phone) | The full suite at 360 px, on its own local stack | 4 to 5 min |
| End to end (desktop) | The full suite at 1440 px, on its own local stack | 4 to 5 min |
| Secret scan | gitleaks over the history | 10 s |

Each run reuses two things from the Actions cache. Each restores the same thing a fresh run would
download or build, so the tests are unchanged:

- **Chromium,** keyed on the Playwright version. A cached Chromium skips the `apt` step, which
  once stalled for 11 minutes.
- **The Next.js build cache,** following the Next.js CI build caching guide. A warm build takes
  seconds.

The Supabase Docker images are pulled on every run, deliberately. Measured on 22 October 2026, a
cached copy was slower: restoring it took 33 s and `docker load` 1 min 50 s, against 1.5 to 3 min
for a plain pull. Starting the stack is now the largest fixed cost in each job.

Pull requests can read the caches saved on main, so the first run of a branch is warm too.

## Judging a CI run

**Judge each job, not the run.** On 22 October 2026, during a GitHub Actions incident, a run
reported "success" while its end to end job sat queued and never ran.

The watcher used before merging does the following:

- reads every job;
- passes only when each one finished with `success`;
- stops at the first failure;
- cancels and re-runs a run with a job queued for more than 10 minutes, at most twice. If it is
  still stuck, check https://www.githubstatus.com before trying again.
