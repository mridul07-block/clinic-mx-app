# Velyx support access

IAM-08, PRD section 2 and M16, TAD section 5. Velyx support access is off by default. The Super
Admin turns it on for a time, with a reason, at `/app/support-access` (the "Support access" link on
home). It needs `support_access.grant` in the permission map, so only the Super Admin has it.

Decisions (user, 22 October 2026):

- Velyx support uses its own Clinic Mx logins, marked as Velyx support.
- A support login is read only and sees no clinical records.
- A grant lasts at most `security.support_grant_max_hours` (24).

## Support logins

- **What one is.** A `staff_user` row with `velyx_support = true`. The database requires the role
  to be Super Admin and no ticks (check `staff_user_support_super_admin`).
  - It signs in with two step verification, like every Super Admin.
- **Adding one.** The Super Admin adds it under "Support logins" with an email and a name. It is
  invited like any staff member (IAM-06): by email, or with a one-time link when the email cannot
  be sent.
- **In the staff list.** It shows with a "Velyx support" tag.
  - It can be deactivated, have two step verification reset, or be invited again.
  - Its details cannot be changed: `updateStaff` refuses it.
- **The seed.** It has `support.velyx@clinicmx.test`, local and staging only.

## Grants

- **Turning it on.** "Grant support access" takes whole hours, from 1 to the setting, and a
  reason. It starts now.
  - Grants are timed by the database clock, which the token hook also reads.
  - One grant is active at a time.
  - Rows go in `support_grant` (granted_by, starts_at, ends_at, reason). They are audited like
    every table, never deleted, and only the Super Admin may write them (RLS).
- **Turning it off early.** "End support access now" moves `ends_at` to now and ends every
  support login's Supabase sessions (`internal.end_support_sessions()`).
  - An open support page goes to sign in within a minute (IAM-07 session check).
- **When it runs out.** Nothing has to happen:
  - the next request is refused (`staffForSignIn`);
  - a refreshed token has no `clinic` claim (`internal.staff_claims`);
  - the open page goes to sign in within a minute.

## Signing in

A support login signs in only while a grant is active:

- **Sign in.** `staffForSignIn` and `internal.staff_claims` both check for an active grant. With
  the right password and no grant, sign in says "Support access is off. The clinic's Super Admin
  can turn it on." Any other refusal keeps the general message.
- **The token.** The `clinic` claim carries `support: true`. Tokens from before IAM-08 lack the
  field, so they are refreshed once on their next request (IAM-03).

## Read only, and no clinical records

- **The server.** `staffService` refuses any write by a support login before it validates or opens
  a transaction (`ReadOnlyError`: "Velyx support access is read only."). Every write in the app
  goes through it (rule 17).
- **The permission map.** `deniedToSupport` takes away every clinical action: clinical.read,
  ai_prep.use, the consultant records, session notes and red flags. Kickoff decision C2 lets the
  Super Admin read clinical records without a tick, so its role alone would not keep support out.
- **The database.**
  - `withStaffAccess` runs a support login's transaction `read only`.
  - Every table people reach has RESTRICTIVE policies `support_read_only_insert`, `_update` and
    `_delete` (`NOT internal.jwt_support()`). A CI test (`rls-catalog`) fails for a table without
    all three.
  - `record_access_event`, `end_staff_sessions` and `end_support_sessions` refuse a support claim.
  - **Clinical tables** (CLN tickets) must also refuse a support claim in their SELECT policies,
    with `NOT (SELECT internal.jwt_support())`.
- **The screens.**
  - Every page shows a banner: "Velyx support access, read only, until … Everything you open is
    logged."
  - Write controls are hidden: "Invite staff", the staff forms and buttons, the grant and add
    forms.

## Every request is logged

`proxy.ts` writes one `audit_event` for each request a support login makes while a grant is active:

| Field | Value |
| --- | --- |
| action | `support_request` |
| entity | `support_grant` |
| entity_id | the grant |
| actor | the support login |
| ip | the client address |
| after | `{ path, kind }`, where `kind` is `page` (opened or navigated to) or `action` (a server action, refused or not) |

- **Left out:** the session check, the activity ping and prefetches.
  - By default Next removes the router headers (`next-router-prefetch`,
    `next-router-segment-prefetch`, `rsc`) before the proxy runs. Then a link prefetched from the
    staff list looks like a page opened, which staging showed on the first walkthrough.
  - `next.config.ts` sets `skipProxyUrlNormalize`, so the proxy sees them, and the proxy drops the
    router's `_rsc` query itself.
  - The end to end test waits for such a prefetch and checks it is not logged.
- **Path only:** the query string is never kept, because it can hold search terms (rule 12).
- **Where to read it.** On the support access page, each past grant has "What support opened (n)":
  who opened which page, when, in IST.

## Checking it

- `pnpm --filter @clinic-mx/db test:integration`, file `support.integration.test.ts`:
  - claims and sign in with and without a grant;
  - grants audited;
  - other roles refused;
  - both read only layers, each on its own.
- `apps/web/e2e/support-access.spec.ts`: the whole flow at 360 px and desktop. The phone and desktop
  runs take turns through a Postgres advisory lock, because support access is on or off for the
  whole clinic.
