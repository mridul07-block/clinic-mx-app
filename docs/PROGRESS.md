# Clinic Mx: Progress

## Tickets

| Ticket | Status | Notes | DECISION placeholders |
| --- | --- | --- | --- |
| FND-01 | Done except preview deploys | pnpm monorepo (`apps/web`, `packages/{ui,schemas,db}`); Next.js 16.4 App Router with `/app` (staff) and `/p/[token]` (patient) routes and `/api/health`; TypeScript 6.0 strict (7.0 waits for typescript-eslint support); ESLint 10 flat config with type checked rules, no `any`, described disable comments; Vitest unit tests; Playwright at 360 px phone and 1440 px desktop; CI runs format, lint, typecheck, unit tests, e2e and a gitleaks secret scan on every pull request. Preview deploys per pull request start once the repository is imported into Vercel (FND-02). Fixed during review: the e2e job hung for 15 minutes after all tests passed, because pnpm 12.6 runs scripts in their own process group and Playwright's SIGKILL to the web server's group missed the Next.js server started through `pnpm start`; the web server now runs `next` directly (reproduced on Linux; guarded by `apps/web/playwright.config.test.ts`). Branch protection is not available on a free personal plan for private repositories, so "CI must pass" is a convention until the plan is upgraded. | none |
| FND-02 | Done for the free plan | Vercel project `clinic-mx-app` (Hobby scope) connected to the repository: root `apps/web`, Next.js, Node.js 24.x, Corepack for pnpm 12, project default region and `vercel.json` both `bom1`; deployment record confirms functions in `bom1`. Server env validated in `apps/web/lib/env.ts`, listed in `.env.example`; `/api/health` reports region and environment. Pull requests get preview deployments (Vercel checks green on PR #2). Vercel Authentication protects every deployment. Hobby "Production" serves staging; a separate production environment waits for Vercel Pro (`docs/runbooks/upgrade-to-production.md`). | none |
| FND-03 | Done for the free plan | Staging project "Clinic Mx" live in Mumbai (`ap-south-1`), Postgres 17, linked to the repository (`supabase migration list --linked` reaches it). Supabase CLI 2.121.0 pinned with `pnpm db:start`, `db:status`, `db:stop`; `supabase/config.toml` keeps Postgres 17 and turns off Studio, analytics and the edge runtime. The local stack runs in CI ("Local Supabase stack" job, checks Postgres 17) instead of on the development machine (low RAM, nearly full C: drive). Production project and spend cap wait for the upgrade to Pro. The development ISP (ACT Fibernet) DNS-blocks `<ref>.supabase.co`; documented in `docs/runbooks/supabase.md`. | none |

## DECISION register

Open decisions from PRD section 10, and the defaults agreed for them. Each ticket that uses one adds
the code location.

| # | Decision | Agreed default | Used in |
| --- | --- | --- | --- |
| 2 | Consultation length | 45 minutes, overridable per physio (setting) | not yet |
| 5 | Weight loss red flag threshold | Placeholder setting | not yet |
| 6 | Morning stiffness red flag threshold | Placeholder setting | not yet |

## Agreed decisions from the kickoff review (21 October 2026)

- C1: patient identity and past episodes readable across centres with the Treats tick; centre scope
  limits operational lists; every cross centre record view is audited.
- C2: Super Admin reads clinical records without the tick; signing always needs the Treats tick.
- C3: Centre Managers see list prices, never patient bills, payments or balances.
- C4: episode created at check in for consultation appointments only, as Intake pending.
- C5: knowledge base import in Phase 1 to 2.
- C6: staff URLs `/app/...`, patient URLs `/p/<token>`.
- G2: 15 minute slot step, no buffer; machines as resources with a per centre capacity setting
  (Zero Gravity Treadmill, default 1); exclusion constraints for physio and resource overlaps.
- G4: `consultation_price_item_id` on staff. G5: Consultant requires Treats; physios always Treats.
- G6: one global OP number per patient; appointment ID prefixes MVH, MVK, MVW (settings).
- G7: desktop = fine pointer and width at least 1024 px; phone session lifetime 30 days (setting).
- G8: `modules/settings` for settings and centres.
- G9: Resend as Supabase Auth custom SMTP.
- G10: discharge reasons: Goals achieved; Independent self management; Referred; Patient choice;
  Financial or logistical barrier; Lost to follow up; Other (with note).
- Hosting: Vercel Hobby and Supabase Free until production; upgrade before go live.
