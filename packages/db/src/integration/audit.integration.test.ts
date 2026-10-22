import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { logRecordView, staffActor, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { auditEvent, centre, staffUserCentre } from '../schema';
import { centreIds, seedCentres, seedStaff } from '../seed/data';

// Any valid centre colour; taken from the seed so no colour is written here.
const [firstCentre] = seedCentres;
if (!firstCentre) throw new Error('seed has no centres');
const testColour = firstCentre.colour;
// Centre codes never repeat (SCH-01); four random letters keep test centres apart.
const testCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    String.fromCharCode(65 + (byte % 26)),
  ).join('');

// FND-11 done when: every write stores actor, before and after; clinical record views logged.
// Runs against the CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

const physio = seedStaff.find((s) => s.role === 'physiotherapist');
if (!physio?.id) throw new Error('seed has no physiotherapist');
const actor = staffActor(physio.id);

const eventsFor = (entityId: string) =>
  db
    .select()
    .from(auditEvent)
    .where(and(eq(auditEvent.entity, 'centre'), eq(auditEvent.entityId, entityId)))
    .orderBy(auditEvent.id);

describe('audited writes', () => {
  it('record the actor, the row before and after, for insert, update and delete', async () => {
    const id = crypto.randomUUID();
    await withActor(db, { actor, ip: '203.0.113.7' }, (tx) =>
      tx.insert(centre).values({
        id,
        name: `Audit test ${id}`,
        code: testCode(),
        appointmentPrefix: testCode(),
        colour: testColour,
        active: false,
      }),
    );
    await withActor(db, actor, (tx) =>
      tx.update(centre).set({ phone: '+91 80000 00000' }).where(eq(centre.id, id)),
    );
    await withActor(db, systemActor('tests'), (tx) => tx.delete(centre).where(eq(centre.id, id)));

    const events = await eventsFor(id);
    expect(events.map((e) => [e.action, e.actor])).toEqual([
      ['insert', actor],
      ['update', actor],
      ['delete', 'system:tests'],
    ]);
    const [inserted, updated, deleted] = events;
    expect(inserted).toMatchObject({ before: null, after: { id, phone: null }, ip: '203.0.113.7' });
    expect(updated?.before).toMatchObject({ phone: null });
    expect(updated?.after).toMatchObject({ phone: '+91 80000 00000' });
    expect(deleted).toMatchObject({ before: { id }, after: null });
  });

  it('refuse a write that names no actor', async () => {
    await expect(
      db.insert(centre).values({
        name: `No actor ${crypto.randomUUID()}`,
        code: testCode(),
        appointmentPrefix: testCode(),
        colour: testColour,
        active: false,
      }),
    ).rejects.toThrow();
    await expect(
      db.update(centre).set({ phone: 'x' }).where(eq(centre.id, centreIds.hsrLayout)),
    ).rejects.toThrow();
  });

  it('roll back with the write: no event for a change that did not happen', async () => {
    const id = crypto.randomUUID();
    await withActor(db, actor, async (tx) => {
      await tx.insert(centre).values({
        id,
        name: `Rolled back ${id}`,
        code: testCode(),
        appointmentPrefix: testCode(),
        colour: testColour,
        active: false,
      });
      throw new Error('the change failed');
    }).catch(() => undefined);
    expect(await eventsFor(id)).toEqual([]);
  });

  it('skip an update that changes nothing', async () => {
    const before = await db.$count(auditEvent);
    await withActor(db, actor, (tx) =>
      tx.update(centre).set({ name: 'HSR Layout' }).where(eq(centre.id, centreIds.hsrLayout)),
    );
    expect(await db.$count(auditEvent)).toBe(before);
  });

  it('cover rows keyed by several columns too', async () => {
    const staffId = seedStaff.find((s) => s.role === 'front_desk')?.id ?? '';
    await withActor(db, actor, (tx) =>
      tx.insert(staffUserCentre).values({ staffUserId: staffId, centreId: centreIds.whitefield }),
    );
    const [event] = await db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.entity, 'staff_user_centre'), eq(auditEvent.action, 'insert')))
      .orderBy(sql`${auditEvent.id} desc`)
      .limit(1);
    expect(event).toMatchObject({
      entityId: null,
      after: { staff_user_id: staffId, centre_id: centreIds.whitefield },
    });

    // Leave the seeded assignments as they were: other test files count them.
    await withActor(db, actor, (tx) =>
      tx
        .delete(staffUserCentre)
        .where(
          and(
            eq(staffUserCentre.staffUserId, staffId),
            eq(staffUserCentre.centreId, centreIds.whitefield),
          ),
        ),
    );
  });

  it('reject an actor that is not staff, patient or system', async () => {
    await expect(withActor(db, 'someone' as never, () => Promise.resolve())).rejects.toThrow();
  });
});

describe('record views', () => {
  it('are logged with who viewed which record', async () => {
    const id = crypto.randomUUID();
    await logRecordView(db, { actor, entity: 'consultation', entityId: id, ip: '203.0.113.9' });
    const [view] = await db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.action, 'view'), eq(auditEvent.entityId, id)));
    expect(view).toMatchObject({
      actor,
      entity: 'consultation',
      before: null,
      after: null,
      ip: '203.0.113.9',
    });
  });
});

describe('the audit trail', () => {
  it('cannot be changed or deleted, even by the database owner', async () => {
    await expect(db.update(auditEvent).set({ actor: 'system:forged' })).rejects.toThrow();
    await expect(db.delete(auditEvent)).rejects.toThrow();
    await expect(db.execute(sql`truncate audit_event`)).rejects.toThrow();
  });

  it('is unreadable through the Supabase API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('role', ${role}, true)`);
        return tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_event`);
      });
      expect(rows[0]?.n).toBe(0);
    }
  });

  it('covers every table in public, except the exempt ones', async () => {
    // job: queue bookkeeping (every status change would bury the real events).
    // rate_limit: a counter per attempt (IAM-11); the attempts themselves are the events.
    // audit_event: the trail itself.
    // centre_sequence: the last number issued (SCH-01); the patient row it numbers is the event.
    // slot_hold: a picked slot held for minutes (SCH-04); the appointment booked is the event.
    const exempt = ['audit_event', 'centre_sequence', 'job', 'rate_limit', 'slot_hold'];
    const rows = await db.execute<{ table: string }>(sql`
      select c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_trigger t
          where t.tgrelid = c.oid and t.tgname = 'audit_change' and not t.tgisinternal
        )
      order by 1`);
    expect(rows.map((r) => r.table)).toEqual(exempt);
  });
});
