import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { logAccessEvent, staffActor, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { staffForSignIn } from '../identity';
import { auditEvent, staffUser } from '../schema';
import { seedStaff } from '../seed/data';

// IAM-01: who may sign in. Runs against the CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });

const member = seedStaff.find((s) => s.email === 'physio.koramangala@clinicmx.test');
if (!member?.id) throw new Error('seed has no Koramangala physio');
const staffUserId = member.id;
const authUserId = crypto.randomUUID();
const tests = systemActor('tests');

const setStaff = (values: Partial<typeof staffUser.$inferInsert>) =>
  withActor(db, tests, (tx) =>
    tx.update(staffUser).set(values).where(eq(staffUser.id, staffUserId)),
  );

let original: { authUserId: string | null; active: boolean; accessEndsAt: Date | null };
beforeAll(async () => {
  const [row] = await db.select().from(staffUser).where(eq(staffUser.id, staffUserId));
  if (!row) throw new Error('seed staff row missing');
  original = { authUserId: row.authUserId, active: row.active, accessEndsAt: row.accessEndsAt };
  await setStaff({ authUserId, active: true, accessEndsAt: null });
});
afterAll(async () => {
  await setStaff(original);
  await close();
});

describe('staffForSignIn', () => {
  it('finds the active staff member linked to a login', async () => {
    expect(await staffForSignIn(db, authUserId)).toMatchObject({
      id: staffUserId,
      role: 'physiotherapist',
      treatsPatients: true,
    });
  });

  it('finds nobody for a login linked to no staff member', async () => {
    expect(await staffForSignIn(db, crypto.randomUUID())).toBeUndefined();
  });

  it('refuses a deactivated staff member', async () => {
    await setStaff({ active: false });
    expect(await staffForSignIn(db, authUserId)).toBeUndefined();
    await setStaff({ active: true });
  });

  it('refuses a staff member whose access has ended, and allows one whose end is ahead', async () => {
    const now = new Date('2026-10-21T10:00:00Z');
    await setStaff({ accessEndsAt: new Date('2026-10-21T09:59:59Z') });
    expect(await staffForSignIn(db, authUserId, now)).toBeUndefined();
    await setStaff({ accessEndsAt: new Date('2026-10-21T10:00:01Z') });
    expect(await staffForSignIn(db, authUserId, now)).toMatchObject({ id: staffUserId });
    await setStaff({ accessEndsAt: null });
  });
});

describe('access events', () => {
  it('record sign in, sign out and password changes against the staff member', async () => {
    const actor = staffActor(staffUserId);
    for (const action of ['sign_in', 'sign_out', 'password_change'] as const) {
      await logAccessEvent(db, { actor, ip: '203.0.113.20', action, staffUserId });
    }
    const events = await db
      .select({ action: auditEvent.action, ip: auditEvent.ip })
      .from(auditEvent)
      .where(and(eq(auditEvent.entity, 'staff_user'), eq(auditEvent.ip, '203.0.113.20')));
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['sign_in', 'sign_out', 'password_change']),
    );
  });
});
