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
- **Audit**: `sign_in`, `sign_out` and `password_change` events in `audit_event` with the address.
- **Offline**: the service worker caches the offline page only, never a signed in page.

Two step verification is IAM-02, roles and claims IAM-03, session lifetimes and revocation IAM-07,
rate limits IAM-11, staff invitations IAM-06.

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
