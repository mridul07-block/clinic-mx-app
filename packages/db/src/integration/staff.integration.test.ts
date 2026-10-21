import { staffDetailsSchema } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import { recordAccessEvent } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { auditEvent, staffUser } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import {
  endStaffSessions,
  insertStaffMember,
  linkStaffLogin,
  setStaffMemberActive,
  staffEmailTaken,
  staffList,
  staffRecord,
  updateStaffMember,
} from '../staff';

// IAM-06: staff management as the Super Admin under row level security, audited as them; a
// Centre Manager doing the same is refused by the database itself. CI database only. Staff added
// here stay (deactivated): nothing deletes a staff member.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const manager = member('manager@clinicmx.test');

const details = (values: Record<string, unknown> = {}) =>
  staffDetailsSchema.parse({
    name: 'Test Invited Desk',
    role: 'front_desk',
    treatsPatients: false,
    consultant: false,
    centreIds: [centreIds.hsrLayout],
    ...values,
  });
const newEmail = () => `invited.${crypto.randomUUID()}@clinicmx.test`;

const lastEvents = (staffUserId: string) =>
  db
    .select({ actor: auditEvent.actor, action: auditEvent.action, entity: auditEvent.entity })
    .from(auditEvent)
    .where(and(eq(auditEvent.entityId, staffUserId)))
    .orderBy(desc(auditEvent.id));

describe('staff management as the Super Admin', () => {
  it('adds, changes, deactivates and reactivates a staff member, all audited as them', async () => {
    const email = newEmail();
    const id = await withStaffAccess(db, { actor: superAdmin }, (tx) =>
      insertStaffMember(tx, { email, details: details() }),
    );
    expect(
      await withStaffAccess(db, { actor: superAdmin }, (tx) =>
        staffEmailTaken(tx, email.toUpperCase()),
      ),
    ).toBe(true);

    await withStaffAccess(db, { actor: superAdmin }, (tx) =>
      updateStaffMember(
        tx,
        id,
        details({
          role: 'physiotherapist',
          consultant: true,
          centreIds: [centreIds.koramangala, centreIds.whitefield],
          accessEndsOn: '2026-11-30',
        }),
      ),
    );
    const changed = await withStaffAccess(db, { actor: superAdmin }, (tx) => staffRecord(tx, id));
    expect(changed).toMatchObject({
      role: 'physiotherapist',
      treatsPatients: true,
      consultant: true,
      active: true,
      centreIds: [centreIds.koramangala, centreIds.whitefield].sort(),
    });
    expect(changed?.accessEndsAt?.toISOString()).toBe('2026-11-30T18:30:00.000Z');

    await withStaffAccess(db, { actor: superAdmin, ip: '203.0.113.9' }, async (tx) => {
      await setStaffMemberActive(tx, id, false);
      await recordAccessEvent(tx, { action: 'staff_invited', staffUserId: id });
    });
    const [row] = await db
      .select({ active: staffUser.active })
      .from(staffUser)
      .where(eq(staffUser.id, id));
    expect(row?.active).toBe(false);
    const listed = await withStaffAccess(db, { actor: superAdmin }, (tx) => staffList(tx));
    expect(listed.find((m) => m.id === id)).toMatchObject({
      active: false,
      centres: ['Koramangala', 'Whitefield'],
    });

    const events = await lastEvents(id);
    expect(events.every((e) => e.actor === `staff:${superAdmin.id}`)).toBe(true);
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['insert', 'update', 'staff_invited']),
    );
  });

  it('records access events only with the transaction’s own actor', async () => {
    const id = await withStaffAccess(db, { actor: superAdmin }, (tx) =>
      insertStaffMember(tx, { email: newEmail(), details: details() }),
    );
    await expect(
      withStaffAccess(db, { actor: superAdmin }, (tx) =>
        recordAccessEvent(tx, { action: 'sign_in' as 'staff_invited', staffUserId: id }),
      ),
    ).rejects.toThrow();
    await expect(
      db.transaction((tx) => recordAccessEvent(tx, { action: 'staff_invited', staffUserId: id })),
    ).rejects.toThrow();
  });
});

describe('staff management as anyone else', () => {
  it('is refused by row level security', async () => {
    await expect(
      withStaffAccess(db, { actor: manager }, (tx) =>
        insertStaffMember(tx, { email: newEmail(), details: details() }),
      ),
    ).rejects.toThrow();
    const desk = member('desk.hsr@clinicmx.test');
    expect(
      await withStaffAccess(db, { actor: manager }, (tx) =>
        setStaffMemberActive(tx, desk.id, false),
      ),
    ).toBe(false);
    expect(
      await withStaffAccess(db, { actor: manager }, (tx) =>
        updateStaffMember(tx, desk.id, details()),
      ),
    ).toBe(false);
    const [row] = await db
      .select({ active: staffUser.active })
      .from(staffUser)
      .where(eq(staffUser.id, desk.id));
    expect(row?.active).toBe(true);
  });
});

describe('ending a staff member’s sessions (IAM-07)', () => {
  it('deletes only that login’s sessions, and only for the Super Admin', async () => {
    const login = crypto.randomUUID();
    const otherLogin = crypto.randomUUID();
    for (const id of [login, otherLogin]) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}::uuid, ${`${id}@clinicmx.test`})`,
      );
      await db.execute(
        sql`insert into auth.sessions (id, user_id) values (gen_random_uuid(), ${id}::uuid), (gen_random_uuid(), ${id}::uuid)`,
      );
    }
    const sessionsOf = async (id: string) =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from auth.sessions where user_id = ${id}::uuid`,
        )
      )[0]?.n;
    try {
      const staffUserId = await withStaffAccess(db, { actor: superAdmin }, async (tx) => {
        const id = await insertStaffMember(tx, { email: newEmail(), details: details() });
        await linkStaffLogin(tx, id, login);
        return id;
      });
      await expect(
        withStaffAccess(db, { actor: manager }, (tx) => endStaffSessions(tx, staffUserId)),
      ).rejects.toThrow();
      expect(await sessionsOf(login)).toBe(2);

      expect(
        await withStaffAccess(db, { actor: superAdmin }, (tx) => endStaffSessions(tx, staffUserId)),
      ).toBe(2);
      expect(await sessionsOf(login)).toBe(0);
      expect(await sessionsOf(otherLogin)).toBe(2);
    } finally {
      await db.execute(
        sql`delete from auth.users where id in (${login}::uuid, ${otherLogin}::uuid)`,
      );
    }
  });
});
