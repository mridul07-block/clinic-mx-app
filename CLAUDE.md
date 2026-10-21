## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
_GS=""
for _D in "${GSTACK_ROOT:-}" "$HOME/.claude/skills/gstack" "$HOME/.codex/skills/gstack" "$HOME/.factory/skills/gstack" "$HOME/.kiro/skills/gstack" "$HOME/.config/opencode/skills/gstack" "$HOME/.slate/skills/gstack" "$HOME/.cursor/skills/gstack" "$HOME/.openclaw/skills/gstack" "$HOME/.hermes/skills/gstack" "$HOME/.gbrain/skills/gstack" "$HOME/.copilot/skills/gstack" "$HOME/.gemini/antigravity-cli/skills/gstack" "$HOME/.gstack/repos/gstack"; do
  [ -z "$_GS" ] && [ -n "$_D" ] && [ -d "$_D/bin" ] && _GS="$_D"
done
[ -n "$_GS" ] && echo "GSTACK_OK: $_GS" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing (Aside first, the bundled gstack browser as fallback).
Use the resolved install path above for gstack file paths
(default: ~/.claude/skills/gstack).

## Clinic Mx

Clinic management platform for Movementology Clinics (HSR Layout, Koramangala, Whitefield),
built by Velyx Labs. pnpm monorepo: `apps/web` (Next.js App Router) and `packages/{ui,schemas,db}`.

### Source of truth

Order of authority: `docs/Clinic_Mx_PRD.md`, then `docs/Clinic_Mx_TAD.md`, then
`docs/Clinic_Mx_Frontend_Specification.md`, then `docs/Clinic_Mx_Feature_Ticket_List.md`, then the
Blueprint. Design system v2: `docs/design/`. Workbooks: `docs/Joint wise AI Training/`. Ask when the
documents are silent or conflict; never invent product behaviour or clinical content.

### Commands

`pnpm install` · `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e` ·
`pnpm format`

### Non negotiable rules

1. The clinical episode is the backbone; packages, bills and messages never close or change care.
2. Gates are enforced in code (consent, pricing, screening, signing, criteria, no overbooking).
3. AI suggests, clinicians decide; safety, money, scheduling, scoring and clearance are deterministic.
4. Clinical knowledge is versioned data; every clinical record stores its knowledge base version.
5. Every write is audited (actor, before, after); signed records are immutable, changes are addenda.
6. Every business rule is a setting read from the `settings` table; no magic numbers.
7. Mobile first: build and test every screen at 360 px first.
8. English only everywhere.
9. The browser never calls `*.supabase.co`; everything goes through our domain.
10. Access is enforced twice: server permission checks and Postgres RLS, with RLS tests per role.
11. No names, phone numbers or IDs to any AI model; zero data retention on every AI request.
12. No patient data in logs, error reports or test fixtures; generated fake data only.
13. Secrets only in environment variables.
14. TypeScript strict; no `any` without a described disable comment.
15. Money in integer paise; times stored in UTC, shown in IST.
16. Zod schemas in `packages/schemas`, shared by client and server.
17. Every write goes through a module service: permission, validate, transaction, audit event.
18. Migrations are forward only and backwards compatible.
19. Tests ship with the code: unit, RLS, and Playwright at 360 px and desktop.

### Ticket workflow

Restate the ticket and its "done when" check, implement with tests, run format, lint, typecheck and
tests until clean, verify at 360 px, commit with a message starting with the ticket ID
(`SCH-04: ...`), and add a line to `docs/PROGRESS.md`. Open decisions from PRD section 10 become
settings or placeholders marked `// DECISION #n` and are listed in the DECISION register there.
