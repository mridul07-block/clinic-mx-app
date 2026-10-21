# Clinic Mx: Progress

## Tickets

| Ticket | Status | Notes | DECISION placeholders |
| --- | --- | --- | --- |
| FND-01 | Done except preview deploys | pnpm monorepo (`apps/web`, `packages/{ui,schemas,db}`); Next.js 16.4 App Router with `/app` (staff) and `/p/[token]` (patient) routes and `/api/health`; TypeScript 6.0 strict (7.0 waits for typescript-eslint support); ESLint 10 flat config with type checked rules, no `any`, described disable comments; Vitest unit tests; Playwright at 360 px phone and 1440 px desktop; CI runs format, lint, typecheck, unit tests, e2e and a gitleaks secret scan on every pull request. Preview deploys per pull request start once the repository is imported into Vercel (FND-02). Branch protection is not available on a free personal plan for private repositories, so "CI must pass" is a convention until the plan is upgraded. | none |

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
