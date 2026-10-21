# Staff sign in

IAM-01, rule 9, TAD section 5. Staff sign in with email and password on our own domain. The
browser posts to our server (Next.js server actions in `apps/web/modules/auth/actions.ts`); only
the server calls Supabase Auth. The browser never receives the Supabase URL or a key.

## How it works

- **Sign in** (`/app/sign-in`): the server signs in with Supabase Auth, then accepts the login only
  if it is linked to an active staff row with no passed end date (`staffForSignIn`). Anyone else
  gets the same message as a wrong password, so the page never says whether an email has an account.
- **Session**: Supabase's session cookies, set by our server as HTTP only, secure, same site (lax)
  cookies (`apps/web/lib/supabase/cookies.ts`). `apps/web/proxy.ts` refreshes them on every staff
  app request and sends anyone without a session to sign in, remembering the page (`?next=`, only
  ever a staff app path). The signed in layout checks the staff row on every page.
- **Password reset** (`/app/forgot-password`): Supabase emails a link to
  `<site URL>/app/reset-password?token_hash=...` (template `supabase/templates/recovery.html`). The
  token is used only when the new password is submitted, so mail scanners that open links cannot
  use it up. After a change every device is signed out (`password=changed` notice on sign in).
- **Sign out**: drafts are saved first; drafts that cannot be saved are deleted from the device
  only after the person agrees, so the next person on a shared phone never sees them.
- **Audit**: `sign_in`, `sign_out`, `password_change`, `two_step_on` and `two_step_reset` events
  in `audit_event` with the address. `sign_in` is recorded when the sign in is complete.
- **Offline**: the service worker caches the offline page only, never a signed in page.

Roles and claims are IAM-03, session lifetimes and revocation IAM-07, rate limits IAM-11, staff
invitations IAM-06.

## Two step verification (IAM-02)

A code from an authenticator app (TOTP, Supabase Auth MFA) after the password: required for Super
Admin, Centre Manager, Physiotherapist and Finance; optional for Front Desk (TAD section 5).

- **Sign in**: after the password the session is at assurance level aal1. Someone with an
  authenticator app goes to `/app/two-step` for a code; a required role without one goes to
  `/app/two-step/setup`. Only a code raises the session to aal2. `requireStaff`, used by every
  signed in page and server action, lets a session through only when its stage is complete
  (`signInStage` in `apps/web/modules/auth/two-step.ts`). The level comes from the session's
  signed token, the authenticator apps from Supabase Auth itself, never from the cookie.
- **Setup**: the page adds an authenticator app and shows a QR code (an SVG drawn in the page),
  an "Add to authenticator app" link for the same phone, and the key to type. The first code
  turns it on. Unfinished setups are removed on the next visit.
- **Front Desk**: never asked at sign in; turns it on from `/app/account` (decision 21 October
  2026). Once on, they enter a code at every sign in like everyone else.
- **Password reset**: with two step verification on, Supabase changes the password only after a
  code too, so the reset form asks for one when needed.
- **Lost phone** (decision 21 October 2026): the Super Admin resets the person's two step
  verification (`resetTwoStep` in `apps/web/modules/auth/two-step-reset.ts`, audited as
  `two_step_reset`; the button arrives with the staff screen, IAM-06). Their next sign in asks
  them to set it up again. It needs `SUPABASE_SERVICE_ROLE_KEY` on the server (Vercel, added with
  IAM-06).
- **Super Admin lost their own phone**: Velyx support removes the factor in the Supabase dashboard
  (Authentication, Users, the user, Multi factor authentication, delete the factor) once the
  request is confirmed with the clinic.
- **Supabase behaviour to know**: two code checks for one person that overlap can deadlock in
  Supabase Auth (a server error); the server retries twice. A completed code check also ends that
  person's other sign ins still waiting for a code.

Settings: TOTP enroll and verify on (`[auth.mfa.totp]` in `supabase/config.toml`; on by default on
hosted projects, checked on staging 21 October 2026).

## Role, ticks and centres in the token (IAM-03)

Every token Supabase issues carries a `clinic` claim, read by row level security (IAM-05):

```json
{ "staff_id": "…", "role": "physiotherapist", "treats_patients": true, "consultant": true,
  "all_centres": false, "centres": ["<centre id>"] }
```

- `internal.staff_claims(auth_user_id)` builds it from `staff_user` and `staff_user_centre`; null
  for anyone who is not an active staff member before their end date. `all_centres` is true for
  Super Admin and Finance (PRD section 2). The shape is `staffClaimsSchema` in
  `packages/schemas/src/staff.ts`.
- The custom access token hook `internal.custom_access_token_hook` adds it at sign in, at the two
  step code and at every refresh. Only `supabase_auth_admin` may run it.
- **Refreshed on change**: `apps/web/proxy.ts` compares the token's claim with `staff_claims` on
  every staff request and, if they differ, refreshes the session at once, so the new role, ticks or
  centres apply from the next page or action. The two step level is kept. If the refresh fails,
  the stale token is not accepted (`signInState`) and the person signs in again.
- Readers for policies: `internal.jwt_staff_role()`, `jwt_treats()`, `jwt_consultant()`,
  `jwt_centre_ids()`, `jwt_sees_centre(centre_id)`, callable by the `authenticated` role.

**Enabling the hook per environment**, in this order: apply the migration (`*_staff_claims.sql`),
turn the hook on, then deploy the app. A hook that does not exist stops every sign in, and the app
refuses tokens without the claim, so staff cannot sign in between the deploy and the hook. Locally
`[auth.hook.custom_access_token]` in `supabase/config.toml`; on a hosted project the Management API
`PATCH /v1/projects/<ref>/config/auth` with `hook_custom_access_token_enabled: true` and
`hook_custom_access_token_uri: "pg-functions://postgres/internal/custom_access_token_hook"` (or
Authentication, Hooks in the dashboard).

## Settings per environment

Supabase project auth settings (Authentication in the dashboard, or the Management API
`PATCH /v1/projects/<ref>/config/auth`). Local values are in `supabase/config.toml`.

| Setting | Value |
| --- | --- |
| Site URL | The app's address: staging `https://clinic-mx-app.vercel.app` (the clinic domain later) |
| Allow new users to sign up | Off (`disable_signup: true`) |
| Minimum password length | 12 (`PASSWORD_MIN_LENGTH` in `packages/schemas/src/auth.ts`) |
| Reset password email | Subject "Reset your Clinic Mx password", body from `supabase/templates/recovery.html` |

Vercel environment variables (Production and Preview): `SUPABASE_URL`, `SUPABASE_ANON_KEY`
(server only, never `NEXT_PUBLIC_`), with `DATABASE_URL` from FND-10.

Email: Supabase's built in sender only delivers to the project's team members and a few emails
an hour, and on the free plan it does not allow changing the email template. So on staging the
reset email still has Supabase's default link, which does not work with our reset page, until the
custom SMTP sender (Resend, decision G9) is set up; then set the reset email template above. Until
then resets are tested locally, where Mailpit catches every email (http://127.0.0.1:54324). Set
21 October 2026 on staging: site URL, sign ups off, minimum length 12.

## Test logins

`pnpm db:seed` gives the nine seed staff (`@clinicmx.test`, generated people) logins when
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `CLINIC_MX_SEED_STAFF_PASSWORD` are set. The
staging password is in the repository secret `STAGING_SEED_STAFF_PASSWORD` (and in the developer's
`apps/web/.env.local`); the Migrate staging workflow also needs `STAGING_SUPABASE_URL` and
`STAGING_SUPABASE_SERVICE_ROLE_KEY`. Production never runs the seed.

## Running the end to end tests locally

```sh
pnpm db:start                     # local stack: database, Auth, Mailpit
pnpm exec supabase status -o env  # API_URL, ANON_KEY, SERVICE_ROLE_KEY for the variables below
export SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export DIRECT_DATABASE_URL=$DATABASE_URL CLINIC_MX_SEED_TARGET=local
export CLINIC_MX_SEED_STAFF_PASSWORD=<any 12 or more characters>
pnpm db:seed && pnpm test:e2e
```

Variables set in the shell win over `apps/web/.env.local`, so the tests never reach staging.
