# Row level security

IAM-05, rule 10, TAD section 5. Access is checked twice:

1. **The server** checks the permission map (IAM-04, `docs/runbooks/permissions.md`).
2. **Postgres** checks row level security (RLS) policies on every table, so a bug in one layer
   cannot show another centre's or another role's rows.

## How staff queries run under RLS

Every staff request reads and writes **as that person**. `withStaffAccess` (`packages/db/src/access.ts`)
opens one transaction and does three things:

- names the person as the audit actor;
- runs `set local role authenticated`;
- sets `request.jwt.claims` to their `clinic` claim (role, ticks, centres).

The claim is built from the staff member (`claimsForStaff`) and equals the claim in their token:
the app refuses any request whose token differs from the database (IAM-03), and a test compares
the two with `internal.staff_claims`. Everything is local to the transaction, so a pooled
connection never keeps the role.

In the web app:

- **Writes:** `staffService` (`apps/web/modules/access/service.ts`).
- **Page reads:** `asStaff(staff, tx => ...)` (`apps/web/modules/access/staff-db.ts`).
- **System work** stays on the owner connection, `appDb()`. That covers:
  - sign in (`staffForSignIn`) and its access audit events;
  - the token claims check in `proxy.ts`;
  - the settings reader;
  - jobs.

  No person drives these reads directly.

ESLint enforces the split:

- `appDb` may be imported only in `proxy.ts`, `lib/`, `modules/auth`, `modules/settings`,
  `modules/jobs` and `modules/access`;
- `withStaffAccess`, `withActor` and the other audited writers may be imported only in
  `modules/access`.

## Policies

Migration `20261021182937_row_level_security.sql`. Every policy is `TO authenticated` and reads the
claim through the IAM-03 readers (`internal.jwt_staff_id`, `jwt_staff_role`, `jwt_sees_centre`).
`anon` has no policy anywhere, so the Supabase API key alone sees nothing.

| Table | Read | Write |
| --- | --- | --- |
| `centre` | Centres the person sees (all for Super Admin and Finance) | Super Admin inserts and updates |
| `staff_user` | Themselves; colleagues assigned to a centre they see; everyone for the Super Admin | Super Admin inserts and updates |
| `staff_user_centre` | Their own; those in centres they see | Super Admin inserts and deletes |
| `audit_event` | Super Admin | None (the SECURITY DEFINER audit trigger writes it) |
| `setting` | Super Admin | Super Admin updates; the app reads values through the system reader |
| `task` | For them, for their role, or all for the Super Admin | The same people update (close with a decision) |
| `job` | None: server only | None |

No table has a delete policy except centre assignments. Staff are deactivated, never deleted.

Colleague visibility uses `internal.staff_in_seen_centre(staff_id)`, a SECURITY DEFINER function,
so the `staff_user` policy does not run the `staff_user_centre` policies again.

Still to come, with the tickets that create what they need:

- **Bills and packages (BIL-05, BIL-08):** Centre Managers read only a `payment_pending` view and
  physios only a `sessions_left` view. Neither may ever select an amount (decision 21 October 2026:
  the views come with the tables).
- **Audit:** the Centre Manager's clinical audit for their centres and Finance's audit, once
  audit events carry a category.
- **Tasks:** centre scope, once tasks link to patients and episodes.

## Adding a table

1. In the same migration: enable RLS, add policies `TO authenticated` for each operation the app
   needs, and add the audit trigger (FND-11). Read the claim through the `internal.jwt_*` readers,
   wrapped as `(SELECT ...)` when the value does not depend on the row.
2. Money: never give Centre Manager or Physiotherapist a policy on a table with amounts. Give them a
   view with `security_invoker = true` that exposes only the flag they may see.
3. Velyx support (IAM-08): add the three RESTRICTIVE policies `support_read_only_insert`,
   `support_read_only_update` and `support_read_only_delete` with `NOT (SELECT internal.jwt_support())`
   (see `20261021200452_support_access_rules.sql`). A clinical table's SELECT policy also needs
   `NOT (SELECT internal.jwt_support())`: support never reads clinical records
   (`docs/runbooks/support-access.md`).
4. Add the table to `rls.integration.test.ts`: which rows each role sees and which writes succeed.
5. `rls-catalog.integration.test.ts` fails in CI if any table in `public` has RLS off, has no
   policy (unless it is in the short server-only list with a reason), has a policy for `anon` or
   everyone, lacks the three support read only policies, or if any view is not
   `security_invoker`.

## Tests

- `packages/db/src/integration/rls.integration.test.ts` runs every role as a seed staff member
  (Super Admin, Finance, Centre Manager, Front Desk HSR, Physio Whitefield, among others). It
  checks:
  - the exact centres, staff, assignments and tasks each person sees;
  - that only the Super Admin reads the audit trail and settings, and nobody reads jobs;
  - who may change centres, staff, assignments, settings and tasks;
  - that nobody deletes staff or centres;
  - that a change is audited as the person who made it;
  - that the claim equals the token's.
- Opening the `centre` read policy to everyone makes the test fail (checked 22 October 2026).
- End to end: the account page reads the person's centres under RLS.
