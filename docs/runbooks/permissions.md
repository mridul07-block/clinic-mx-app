# Permissions

IAM-04, rule 10, rule 17, TAD section 5. What each staff member may do is decided in one place,
the permission map in code, and every service function checks it before it touches the database.
Row level security (IAM-05, `docs/runbooks/row-level-security.md`) checks again inside Postgres,
so a bug in one layer cannot leak data.

## The map

`packages/schemas/src/permissions.ts`. One row per action, one grant per role. The rows follow the
access summary in PRD section 2. There is no runtime editor: a change is a code change, reviewed
like any other.

A grant is one of:

- **allowed** (`yes`);
- **allowed with ticks** (`treats`, `consultant`, or both for signing a consultant record);
- **own records only** (`own`): a physio's own leave, own schedule, own patients' dashboard;
- **never** (`no`).

Centres limit every action: staff act only in their assigned centres, while Super Admin and Finance
act in all of them (`seesAllCentres`, the same rule as `internal.staff_claims`).

How the less obvious PRD cells are read (decided with IAM-04, 21 October 2026):

- **Physios and clinical cells:** these need the Treats patients tick. Physios always have it
  (decision G5), and a physio without it would be refused.
- **Signing a consultant record:** diagnosis, plan, clearance and discharge need both Consultant
  and Treats patients ("signing any clinical record requires the Treats patients tick").
- **Super Admin and clinical work:** the Super Admin reads clinical records without a tick, but
  writes and signs notes only with Treats patients.
- **Bills:** Centre Managers see the "payment pending" flag only, and physios see "sessions left"
  only. Neither sees amounts.
- **Front Desk:** no setup or leave actions.
- **Red flag alert decisions:** not in the map yet. The ticket that builds alerts adds them.

Rows the PRD summary does not have, added by the user's decision:

- **`bookings.lift_self_booking_block`** (SCH-09, 23 October 2026): the Super Admin and Centre
  Managers let a blocked patient book themselves again. Front Desk, physios and Finance do not.
- **`opening_entries.manage`** (SCH-13, 27 October 2026): the Super Admin alone enters and
  corrects opening entries for patients already in treatment at launch.

The same map can be read in the browser to hide what someone cannot use, but only the server
decides.

## Checking it

- **Pages:** `requirePermission(action)` (`apps/web/modules/access/require-permission.ts`) instead
  of `requireStaff()`. Anyone without the action goes to `/app/not-allowed`.
- **Writes:** `staffService` (`apps/web/modules/access/service.ts`):

  ```ts
  export const bookAppointment = staffService({
    action: 'bookings.manage',
    input: bookAppointmentSchema, // zod, from packages/schemas
    target: async (input, tx) => ({ centreId: input.centreId }), // the record's centre / owner
    run: async (tx, input, actor) => {
      /* writes; the audit triggers record the actor and address */
    },
  });
  await bookAppointment({ db: appDb(), actor: staff, ip: await clientIp() }, formValues);
  ```

  The order is fixed:
  1. the role and ticks check;
  2. zod validation;
  3. one transaction that names the actor;
  4. the record's centre and owner check;
  5. the work.

  An `own` grant with no `target` owner is refused, so a service cannot forget to say whose
  record it is.
- **Reads and lists:** `accessScope(staff, action)` returns `any`, `own` or none, so the query can
  filter by it. `can(staff, action, { centreId, ownerId })` checks one record.
- **Errors:** a refusal throws `NotAllowedError` (`modules/access/guard.ts`) and bad input throws a
  `ZodError`. Server actions turn them into a form message.

ESLint refuses `withActor`, `setAuditContext`, `updateSetting` and `updateVersioned` from
`@clinic-mx/db` anywhere in `apps/web` except `modules/access/service.ts` and the end to end
helpers. A write that skips the permission check fails CI.

## Adding an action

1. Add the row to `permissionMap`, in the PRD section it belongs to.
2. Add the same row to the expected table in `packages/schemas/src/permissions.test.ts`. That test
   fails until both agree, and it checks every role with every tick combination.
3. Use the action in the page (`requirePermission`) and in the service (`staffService`).
4. If the PRD access summary changes, change it there first, then here.

## Tests

- `permissions.test.ts`: every action × role × tick combination against the PRD table, plus
  centre and own scope.
- `service.test.ts`: a refusal happens before validation and before any transaction, and bad
  input never writes.
- Database: `seesAllCentres` agrees with the token claim for every role.
- End to end (`e2e/permissions.spec.ts`, 360 px and desktop): the permission harness page
  (`/app/test-harness/permission?action=...`, Playwright only) lets Front Desk manage bookings and
  sends them to the not allowed page for staff and clinical actions.
