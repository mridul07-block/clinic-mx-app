# Supabase

## Projects

| Environment | Project | Region | Plan |
| --- | --- | --- | --- |
| Local | `supabase start` (Docker), config in `supabase/config.toml` | this machine | none |
| Staging and previews | "Clinic Mx" (ref in `SUPABASE_PROJECT_REF`) | `ap-south-1` Mumbai | Free |
| Production | created at the upgrade (`upgrade-to-production.md`) | `ap-south-1` Mumbai | Pro, Small compute, spend cap on |

Staging holds generated fake data only (rule 12). Postgres major version 17, the same locally and
on staging (`[db] major_version` in `supabase/config.toml`).

## Credentials

All values live in `apps/web/.env.local` (git ignored) and in the Vercel and GitHub settings that
need them; the names are in `.env.example`.

| Variable | Where in the Supabase dashboard |
| --- | --- |
| `SUPABASE_PROJECT_REF` | Project Settings > General > Project ID |
| `SUPABASE_URL` | Project Settings > Data API > Project URL |
| `SUPABASE_ANON_KEY` | Project Settings > API Keys (publishable, or legacy "anon") |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings > API Keys (secret, or legacy "service_role"); server only |
| `SUPABASE_DB_PASSWORD` | Chosen at project creation; reset under Project Settings > Database |
| `DATABASE_URL` | Connect > Transaction pooler, port 6543 |
| `DIRECT_DATABASE_URL` | Connect > Session pooler, port 5432 (direct connection is IPv6 only on Free) |
| `SUPABASE_ACCESS_TOKEN` | Account > Access Tokens |

## Linking this repository

`supabase link --project-ref <ref>` with `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` in the
environment (never on the command line). The link is stored in `supabase/.temp`, which is git
ignored. Check it with `supabase migration list --linked`.

## Changing the schema

1. Edit the Drizzle schema in `packages/db/src/schema/`.
2. `pnpm db:generate` writes a new `supabase/migrations/<timestamp>_<name>.sql` (pass
   `-- --name <name>` for a readable name) and updates the snapshots in `supabase/migrations/meta/`.
3. Read the SQL. Hand edit only a migration that has not been merged (for example to add a policy
   drizzle-kit cannot express), then run `pnpm db:generate` again to confirm no further changes.
4. Commit the schema and the migration together and open a pull request.

CI checks that the migrations match the schema, and that no merged migration was edited, renamed or
deleted (rule 18: forward only). Every migration must be backwards compatible with the previous
build, because a rollback is a redeploy of that build: add columns as nullable or with defaults,
and remove things in a later release, after no deployed code uses them.

## Migrations on merge

The workflow "Migrate staging" (`.github/workflows/migrate-staging.yml`) runs on every merge to
`main` that touches `supabase/migrations` or `packages/db`: `supabase db push` applies the new
migrations, then the seed refreshes. It can also be run by hand from the Actions tab. It uses the
repository secret `STAGING_DATABASE_URL`, the staging session pooler URL. Environment secrets are not
available for private repositories on the free GitHub plan.

## Seed

`packages/db/src/seed/data.ts`: the 3 centres and 9 test staff (one or more of every role,
emails on `@clinicmx.test`). Fixed ids make it safe to re-run. Staff have no logins yet; IAM-01
creates them and fills `staff_user.auth_user_id`.

Centre addresses came from the clinics' public Google Business listings (21 October 2026) and need
confirming with the clinic: the Koramangala listing is named "Movementology Academy", and no address
was found for Whitefield. Phones and map links are empty until the Super Admin adds them.

To seed by hand, set `CLINIC_MX_SEED_TARGET=local` or `staging` and `DIRECT_DATABASE_URL`, then run
`pnpm db:seed`. It prints row counts only.

## Local stack

`pnpm db:start`, `pnpm db:status`, `pnpm db:stop`. Needs Docker Desktop running and about 2 to 3 GB
of free memory. Studio, analytics and the edge runtime are off in `supabase/config.toml` to keep
memory use low; turn Studio on there when you need the dashboard.

The stack runs in CI (job "Local Supabase stack" in `.github/workflows/ci.yml`) on every pull
request; IAM-05's row level security tests run against it there. The main development machine
(7.7 GB RAM, nearly full C: drive whose page file grows under memory pressure) does not run it
(decision of 21 October 2026); develop against the staging project instead.

## Known network issue: ISP block of supabase.co

On 21 October 2026 the development network (ACT Fibernet, Bangalore) returned a wrong address for
`<ref>.supabase.co` from the system resolver and from 8.8.8.8, and that address reset every
connection. Cloudflare's 1.1.1.1 returns the real address, which works. `*.pooler.supabase.com`
(the database) and `api.supabase.com` (the CLI) are not affected.

- This is the risk in TAD section 12; it is why the browser never calls supabase.co (rule 9).
- On a developer machine behind such a block, Supabase Auth and Storage calls from `pnpm dev` fail
  with `ECONNRESET`. Fix: Windows Settings > Network > DNS server assignment: `1.1.1.1` and
  `1.0.0.1` with DNS over HTTPS on.
- Vercel functions in `bom1` use Vercel's own resolvers and are not affected.
