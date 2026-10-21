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
- No Supabase API role can read it; screens read it through the server (the audit log screen is
  M16, by role: full for Super Admin, clinical for Centre Managers, finance for Finance).
- `before` and `after` hold whole rows, so the trail is as sensitive as the tables it covers.
  Deletion requests under the DPDP Act may require anonymising rows here; that procedure arrives
  with the data export and deletion ticket.
