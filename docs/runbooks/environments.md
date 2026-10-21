# Environments

Clinic Mx runs on the free plans until production (decision of 21 October 2026): Vercel Hobby and
Supabase Free. See `upgrade-to-production.md` for the move to Vercel Pro and Supabase Pro.

## Today (free plans)

| Environment | Where | Database | WhatsApp |
| --- | --- | --- | --- |
| Local | `pnpm dev` on a developer machine | Local Supabase (FND-03/04) with generated fake data | None |
| Staging | Vercel project `clinic-mx-app`, "Production" target, built from `main` | Supabase project `clinic-mx-staging` (Mumbai), fake data only | Meta test number |
| Pull request previews | Vercel "Preview" target, one deployment per pull request | Same staging database | None |

On the Hobby plan Vercel's "Production" target serves staging; real patient data never goes there.

## Vercel project

- Scope: `mridul07-blocks-projects` (Hobby). Project: `clinic-mx-app`.
- Git: `mridul07-block/clinic-mx-app`; `main` deploys to the Production target, every pull request
  gets a Preview deployment.
- Root directory: `apps/web`. Framework: Next.js. Node.js 24.x.
- Functions region: `bom1` (Mumbai), set in `apps/web/vercel.json`. Check it on any deployment:
  `GET /api/health` returns `"region": "bom1"` and the environment name.
- Build: pnpm from `package.json` "packageManager" through Corepack
  (`ENABLE_EXPERIMENTAL_COREPACK=1`, all environments).

## Environment variables

Every variable is listed in `.env.example` and validated in `apps/web/lib/env.ts`. Values are set in
the Vercel project per environment (Production and Preview), never committed. Add a variable to all
three places in the same pull request.
