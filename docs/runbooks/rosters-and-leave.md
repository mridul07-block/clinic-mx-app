# Rosters and leave

SET-04, PRD M2 ("physio availability and leave"), Frontend Specification "Team: rosters and
leave". When the people who treat patients work, where, and when they are away. The slot engine
and calendar (SCH-04, SCH-05) book with `availabilityOn`.

## Decisions (user, 22 October 2026)

- **Roster:** a weekly pattern per person per centre.
  - A day has any number of blocks, for example `09:00-13:00, 14:00-18:00`; gaps are breaks.
  - A change applies from a chosen date, today or later. Earlier weeks keep the pattern they had.
- **Leave:**
  - **Length:** whole days (a first and a last day), or part of one day (a from and a to time).
  - **Requests:** a person requests their own; their Centre Manager or the Super Admin approves
    or declines it. A decline needs a reason, which the person sees.
  - **Recorded leave:** a manager may record someone's leave directly, approved at once, even in
    the past (for example sick leave).
  - **Cancelling:** a person cancels their own request while it waits. A manager cancels
    requested or approved leave of the people they manage.
  - **Own leave:** nobody decides or records their own.
- **Who:** only people who treat patients have rosters and leave here: physios, and a manager or
  the Super Admin with the Treats patients tick. Front Desk and Finance have neither.

## Rules

| Rule | Where |
| --- | --- |
| Times are IST wall clock times on the calendar grid (`scheduling.slot_minutes`, 15) | The service; the setting is read before the transaction (one connection per server, SET-03) |
| A roster's centre is one the person works at, and one the manager sees | The service; RLS `jwt_sees_centre` |
| A person's hours never overlap across centres, for every date the change applies to | The service. Managers read all centres' hours of the people they manage. |
| Requested and approved leave never overlap for one person | Exclusion constraint `staff_leave_no_overlap` (btree_gist, enabled here for G2) |
| Leave is stored as UTC instants; whole days run from IST midnight to IST midnight | `leaveWindow` in `packages/schemas/src/rosters.ts` |
| Clinic opening hours | None in the documents, so none are enforced |

Approved leave stops bookings. Requested leave does not, until it is approved.

## Screens

| Path | Who | What |
| --- | --- | --- |
| `/app/team` ("Team" on home) | Centre Manager, Super Admin (`rosters.manage`) | Leave waiting for a decision, with Approve and Decline (with a reason); the people who treat patients and where they have hours |
| `/app/team/[staffUserId]` | The same | Their hours per centre (current and later versions); Change hours (centre, from date, a field per weekday, prefilled with the hours in effect); their leave with Cancel; Record leave |
| `/app/leave` ("My leave" on home) | Anyone who treats patients (`leave.manage`) | Request leave; their leave with its status and the decline reason; Cancel while it waits |

A support login sees them read only (IAM-08).

## Under the hood

| Part | Where |
| --- | --- |
| Schemas, day parsing, leave windows | `packages/schemas/src/rosters.ts`; IST helpers in `ist.ts` |
| Tables `roster` (one audited row per version, the week as jsonb) and `staff_leave` | `packages/db/src/schema/rosters.ts`, migration `20261022094520_rosters.sql` |
| Policies, the exclusion, `internal.jwt_manages_team()`, `internal.jwt_manages_staff(id)`, audit triggers | `20261022094521_roster_rules.sql` |
| Database functions: `rosterOn`, `availabilityOn`, `leaveFor`, `pendingLeave`... | `packages/db/src/rosters.ts` |
| Services | `apps/web/modules/rosters/services.ts` |

**Row level security.**

| Table | Read | Write |
| --- | --- | --- |
| `roster` | Their own, anyone who sees the centre, and the person's managers | Managers in centres they see, as themselves |
| `staff_leave` | The person and their managers | **Insert:** own requests, or a manager for someone else. **Update:** the person only to cancel a waiting request; a manager for others, never their own. |

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/rosters.test.ts` | Day parsing, the grid, IST leave windows, the decline reason |
| `apps/web/modules/rosters/services.test.ts` | Who sets rosters; dates; grid; clash across centres; own leave only; past dates for managers only; nobody decides their own; cancel rules; overlap message |
| `packages/db/src/integration/rosters.integration.test.ts` | RLS by role; versions in effect; audit; no self decisions; the exclusion; `availabilityOn` cutting out approved leave (rolled back) |
| `apps/web/e2e/rosters.spec.ts` | At 360 px and desktop: a temporary Centre Manager sets a temporary physio's hours (off-grid refused); the physio requests two leaves; the manager declines one with a reason and approves the other; the physio sees both. Front Desk is refused. |
