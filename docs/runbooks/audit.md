# Audit trail

FND-11, rule 5, TAD section 5. Every change records who made it and the row before and after;
every view of a clinical record is logged. The trail is in `audit_event` and never changes.

## Writes

A trigger (`audit_change`) on every audited table writes one `audit_event` row per insert,
update or delete, in the same transaction, so a change and its audit event commit together or
not at all. The trigger refuses any write whose transaction does not name its actor: forgetting
the audit is an error, not a gap.

Name the actor with `withActor` in the module service (rule 17: permission, validate,
transaction, audit event):

```ts
await withActor(db, { actor: staffActor(session.staffUserId), ip }, async (tx) => {
  await tx.update(task).set({ status: 'closed', decision, closedAt: new Date() }).where(...);
});
```

Actors: `staffActor(id)` for a signed in staff member, `patientActor(id)` for a patient acting
through a signed link, `systemActor('jobs')`, `systemActor('seed')` and the like for the system.
An update that changes nothing is not recorded.

## Views

Reads have no trigger. When the server returns a clinical record's details, call
`logRecordView(db, { actor, ip, entity: 'consultation', entityId })`. Lists and searches are not
logged one row at a time; opening a record is.

## New tables

Every table in `public` gets the trigger in the migration that creates it:

```sql
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.<table>
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();
```

A CI database test fails for any table without it, unless it is on the exemption list in
`packages/db/src/integration/audit.integration.test.ts` (today: `job`, queue bookkeeping, and
`audit_event` itself), with the reason written beside it.

## Rules for the trail

- `audit_event` refuses update, delete and truncate for every role, the database owner included.
- Read directly only by the Super Admin; Velyx support only the `support_request` rows logged
  under grants (Support access lists them). Everyone else reads it through `internal.audit_log`
  (below).
- Each event is placed when it is written (`audit_place`, before insert): its part of the trail
  (`category`) and the centre it is about (`centre_id`). The migration that added them placed the
  events already written once, touching nothing else. When a table moves to another part, its
  migration re-places that table's events the same way.
- `before` and `after` hold whole rows, so the trail is as sensitive as the tables it covers.
  Deletion requests under the DPDP Act may require anonymising rows here; that procedure waits for
  the clinic's retention period (DECISION #20), as deletion itself does (ADM-03,
  `docs/runbooks/data-requests.md`). A patient's copy leaves the trail out: it is the clinic's
  record of who did what.

## The audit log screen

ADM-01, `/app/audit` (PRD M16; section 2: "Audit log | Full | Clinical audit, own centres | No |
No | Finance audit"). Every choice below is a recommended default chosen under the user's standing
approval, 29 October 2026 (DECISION ADM-01), for the client to confirm.

**Parts of the trail.** Each table belongs to one part (`internal.audit_category` in the database,
`auditCategory` in `packages/schemas/src/audit-log.ts`). A database test fails for any audited
table not placed on purpose in one of the app's lists, or placed differently in the database:
- **Clinical record:** the record itself: consultations, sessions, measures, tests, diagnoses,
  plans, clearances, phases, readiness, addenda, the health form answers, reports and documents,
  questionnaires, exercise ticks, the AI sheet.
- **Clinical:** the care around it: patients, guardians, episodes, appointments, plan bookings,
  booking counters, consent, red flag alerts, tasks, patient links, feedback, follow ups.
- **Finance:** anything holding money: bills and their lines, payments, refunds and credits,
  packages, opening entries, prices, package types, discounts, plan choices.
- **Setup:** everything else: staff, centres, sign ins, two step verification, settings, the
  knowledge base, rosters, leave, kiosk tablets, notifications, support access.

**Who reads what.**

| Who | Reads |
| --- | --- |
| Super Admin | Every event, with values |
| Centre Manager | Clinical and clinical record events at their own centres, and of tasks only those their inbox shows; a clinical record's values and an episode's discharge words only with the Treats patients tick (otherwise which fields changed); never AI spend |
| Finance | Finance events, with values |
| Velyx support, Front Desk, physiotherapists | Nothing (`audit.view_*` denied to support) |

**An event's centre.** The row's own centre; else its episode's, appointment's, consultation's,
plan's or AI sheet's; else the patient's registering centre. A record view has no row, so the
record opened (a consultation, patient, document or patient link) is read for it. An event with no
centre is the Super Admin's only (`internal.audit_centre`).

**The screen.** Newest first, 50 at a time with **Older**. Filters: **Part** (for the Super
Admin), **Record type**, **From** and **To** (IST days); a malformed filter is dropped, a part or
record type the person may not read is refused. Each event: what was done to which record
type, its part, when (IST), who (staff name, "Patient, through a link" or "System"), the record's
id, and for a change each field from its old value to its new one; an added or removed row lists
its fields. Values over 80 characters are cut; a field withheld from the reader says "hidden". A Home link, **Audit log**, for those who read it.

**Enforced twice.** The page and the service check `audit.view_*`; the database function
`internal.audit_log` (SECURITY DEFINER, run as the person) applies the same parts, centres and
hidden values. It picks the page on the placed columns, newest first, then names the people. Tests: `packages/db/src/integration/audit-log.integration.test.ts`,
`packages/schemas/src/audit-log.test.ts`, `apps/web/e2e/audit-log.spec.ts`.

**Download.** ADM-04 (PRD section 2: "Audit log and data export"). **Download (CSV)**, beside **Show**,
gives the events the person reads for the part, record type and From to To as typed (Show need not
be pressed first), as a CSV file, `clinic-mx-audit-<from>-to-<to>.csv`; recommended defaults chosen
under the user's standing approval, 29 October 2026 (DECISION ADM-04), for the client to confirm.
- **The same events as the screen:** `internal.audit_log` decides them, page by page until an empty
  one; values withheld from the reader say "hidden" (the fields that changed are listed). Columns:
  the event's number (its order), when (IST), who, what, record type, part, record, fields, before
  and after (JSON). A byte order mark first, so spreadsheets read names right; a cell that starts
  like a formula is quoted, so opening it never runs one. Events are chosen by time through
  `audit_event_at_idx`.
- **How much:** From and To are needed, at most `audit.download_max_days` days (31; the setting at
  most 366); more than `audit.download_max_events` events (5,000; at most 50,000) is refused, with
  the advice to narrow it, never cut short. The screen says why (`download=no_span`, `reversed`,
  `too_long` or `too_many`: a code, never text from the address).
- **Audited:** each download is an `export` event on `audit_event` with its filters and count
  (`internal.log_audit_download`), in the Super Admin's part. A POST, so no link from elsewhere starts
  one. The pages are read one after another, not as one snapshot: an event written meanwhile may
  appear.

**Not built.** A filter by person. A patient's own data is exported from their data request
(ADM-03).

