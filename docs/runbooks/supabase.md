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

## Local stack

`pnpm db:start`, `pnpm db:status`, `pnpm db:stop`. Needs Docker Desktop running. Studio, analytics
and the edge runtime are off in `supabase/config.toml` to keep memory use low; turn Studio on there
when you need the dashboard.

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
