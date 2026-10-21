import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsForStaff, withStaffAccess } from '../access';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { currentStaffClaims, type StaffMember } from '../identity';
import { auditEvent, centre, job, setting, staffUser, staffUserCentre, task } from '../schema';
import { centreIds, seedCentres, seedStaff, seedStaffCentres } from '../seed/data';

// IAM-05 done when: tests prove each role sees only allowed rows. Each role runs as a seed staff
// member through withStaffAccess, the way the app runs every staff request. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
const tests = systemActor('tests');

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
  };
}

const superAdmin = member('super.admin@clinicmx.test');
const finance = member('finance@clinicmx.test');
const manager = member('manager@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const deskKoramangala = member('desk.koramangala@clinicmx.test');
const deskWhitefield = member('desk.whitefield@clinicmx.test');
const physioHsr = member('physio.hsr@clinicmx.test');
const physioKoramangala = member('physio.koramangala@clinicmx.test');
const physioWhitefield = member('physio.whitefield@clinicmx.test');
const everyone = [
  superAdmin,
  finance,
  manager,
  deskHsr,
  deskKoramangala,
  deskWhitefield,
  physioHsr,
  physioKoramangala,
  physioWhitefield,
];
const seedIds = new Set(everyone.map((m) => m.id));
const allCentres = Object.values(centreIds);

const as = <R>(actor: StaffMember, work: Parameters<typeof withStaffAccess<R>>[2]) =>
  withStaffAccess(db, { actor }, work);
const sorted = (values: string[]) => [...values].sort();
const ids = (staff: StaffMember[]) => sorted(staff.map((m) => m.id));

/** Seed staff a person sees (rows other tests add are left out). */
const staffSeenBy = async (actor: StaffMember) =>
  sorted(
    (await as(actor, (tx) => tx.select({ id: staffUser.id }).from(staffUser)))
      .map((r) => r.id)
      .filter((id) => seedIds.has(id)),
  );
const centresSeenBy = async (actor: StaffMember) =>
  sorted(
    (await as(actor, (tx) => tx.select({ id: centre.id }).from(centre)))
      .map((r) => r.id)
      .filter((id) => (allCentres as string[]).includes(id)),
  );
const assignmentsSeenBy = async (actor: StaffMember) =>
  sorted(
    (
      await as(actor, (tx) =>
        tx
          .select({ staff: staffUserCentre.staffUserId, centre: staffUserCentre.centreId })
          .from(staffUserCentre),
      )
    )
      .filter((r) => seedIds.has(r.staff))
      .map((r) => `${r.staff}@${r.centre}`),
  );
const assignmentsOf = (staff: StaffMember[]) =>
  sorted(staff.flatMap((m) => m.centreIds.map((c) => `${m.id}@${c}`)));
const countAs = async (
  actor: StaffMember,
  table: typeof auditEvent | typeof setting | typeof job,
) => (await as(actor, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(table)))[0]?.n;

// Tasks for a role and for one person, created by the server the way jobs create them.
const taskIds = { deskRole: '', financeRole: '', physioWhitefield: '' };
beforeAll(async () => {
  const created = await withActor(db, tests, (tx) =>
    tx
      .insert(task)
      .values([
        { kind: 'rls.test', title: 'For Front Desk', assigneeRole: 'front_desk' },
        { kind: 'rls.test', title: 'For Finance', assigneeRole: 'finance' },
        { kind: 'rls.test', title: 'For one physio', assigneeStaffUserId: physioWhitefield.id },
      ])
      .returning({ id: task.id }),
  );
  taskIds.deskRole = created[0]?.id ?? '';
  taskIds.financeRole = created[1]?.id ?? '';
  taskIds.physioWhitefield = created[2]?.id ?? '';
});
afterAll(async () => {
  await withActor(db, tests, (tx) => tx.delete(task).where(eq(task.kind, 'rls.test')));
  await close();
});

describe('the claims staff queries run with', () => {
  it('equal the claims in the person’s token (internal.staff_claims)', async () => {
    const links = new Map<string, string | null>();
    try {
      for (const person of everyone) {
        const [row] = await db
          .select({ authUserId: staffUser.authUserId })
          .from(staffUser)
          .where(eq(staffUser.id, person.id));
        links.set(person.id, row?.authUserId ?? null);
        const login = row?.authUserId ?? crypto.randomUUID();
        if (!row?.authUserId) {
          await withActor(db, tests, (tx) =>
            tx.update(staffUser).set({ authUserId: login }).where(eq(staffUser.id, person.id)),
          );
        }
        expect(await currentStaffClaims(db, login), person.email).toEqual(claimsForStaff(person));
      }
    } finally {
      for (const [id, authUserId] of links) {
        if (authUserId) continue;
        await withActor(db, tests, (tx) =>
          tx.update(staffUser).set({ authUserId: null }).where(eq(staffUser.id, id)),
        );
      }
    }
  });

  it('are given up when the transaction ends', async () => {
    await as(deskHsr, (tx) => tx.select().from(centre));
    const [row] = await db.execute<{ role: string; claims: string | null }>(sql`
      select current_user as role, nullif(current_setting('request.jwt.claims', true), '') as claims`);
    expect(row).toEqual({ role: 'postgres', claims: null });
  });
});

describe('what each role sees', () => {
  it('centres: their own; every centre for Super Admin and Finance', async () => {
    expect(await centresSeenBy(superAdmin)).toEqual(sorted(allCentres));
    expect(await centresSeenBy(finance)).toEqual(sorted(allCentres));
    expect(await centresSeenBy(manager)).toEqual(
      sorted([centreIds.hsrLayout, centreIds.koramangala]),
    );
    expect(await centresSeenBy(deskHsr)).toEqual([centreIds.hsrLayout]);
    expect(await centresSeenBy(physioWhitefield)).toEqual([centreIds.whitefield]);
  });

  it('staff: themselves and colleagues in their centres; everyone for the Super Admin', async () => {
    expect(await staffSeenBy(superAdmin)).toEqual(ids(everyone));
    // Finance sees every centre, so everyone assigned to one; the Super Admin has none.
    expect(await staffSeenBy(finance)).toEqual(ids(everyone.filter((m) => m !== superAdmin)));
    expect(await staffSeenBy(manager)).toEqual(
      ids([manager, deskHsr, deskKoramangala, physioHsr, physioKoramangala]),
    );
    expect(await staffSeenBy(deskHsr)).toEqual(ids([manager, deskHsr, physioHsr]));
    expect(await staffSeenBy(physioWhitefield)).toEqual(ids([deskWhitefield, physioWhitefield]));
  });

  it('centre assignments: those in centres they see', async () => {
    expect(await assignmentsSeenBy(superAdmin)).toEqual(assignmentsOf(everyone));
    expect(await assignmentsSeenBy(manager)).toEqual(
      assignmentsOf([manager, deskHsr, deskKoramangala, physioHsr, physioKoramangala]).filter(
        (a) => !a.endsWith(centreIds.whitefield),
      ),
    );
    expect(await assignmentsSeenBy(deskHsr)).toEqual(
      sorted([
        `${manager.id}@${centreIds.hsrLayout}`,
        `${deskHsr.id}@${centreIds.hsrLayout}`,
        `${physioHsr.id}@${centreIds.hsrLayout}`,
      ]),
    );
  });

  it('the audit trail and settings: the Super Admin only', async () => {
    expect(await countAs(superAdmin, auditEvent)).toBeGreaterThan(0);
    expect(await countAs(superAdmin, setting)).toBeGreaterThan(0);
    for (const person of [finance, manager, deskHsr, physioWhitefield]) {
      expect(await countAs(person, auditEvent), person.email).toBe(0);
      expect(await countAs(person, setting), person.email).toBe(0);
    }
  });

  it('the job queue: nobody', async () => {
    await withActor(db, tests, async (tx) => {
      await tx.insert(job).values({ kind: 'rls.test', payload: {} });
    });
    try {
      for (const person of [superAdmin, finance, manager, deskHsr, physioWhitefield]) {
        expect(await countAs(person, job), person.email).toBe(0);
      }
    } finally {
      await db.delete(job).where(eq(job.kind, 'rls.test'));
    }
  });

  it('tasks: those for their role or for them; all for the Super Admin', async () => {
    const seen = async (actor: StaffMember) =>
      sorted(
        (
          await as(actor, (tx) =>
            tx.select({ id: task.id }).from(task).where(eq(task.kind, 'rls.test')),
          )
        ).map((r) => r.id),
      );
    expect(await seen(superAdmin)).toEqual(sorted(Object.values(taskIds)));
    expect(await seen(deskHsr)).toEqual([taskIds.deskRole]);
    expect(await seen(finance)).toEqual([taskIds.financeRole]);
    expect(await seen(physioWhitefield)).toEqual([taskIds.physioWhitefield]);
    expect(await seen(physioHsr)).toEqual([]);
    expect(await seen(manager)).toEqual([]);
  });
});

describe('what each role may change', () => {
  it('only the Super Admin sets up centres, and the change is audited as them', async () => {
    const setPhone = (actor: StaffMember, phone: string | null) =>
      as(actor, (tx) =>
        tx
          .update(centre)
          .set({ phone })
          .where(eq(centre.id, centreIds.hsrLayout))
          .returning({ id: centre.id }),
      );
    const [original] = await db
      .select({ phone: centre.phone })
      .from(centre)
      .where(eq(centre.id, centreIds.hsrLayout));
    try {
      expect(await setPhone(manager, '+91 80000 00001')).toEqual([]);
      expect(await setPhone(deskHsr, '+91 80000 00001')).toEqual([]);
      expect(await setPhone(superAdmin, '+91 80000 00002')).toHaveLength(1);
      const [event] = await db
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'centre'), eq(auditEvent.entityId, centreIds.hsrLayout)))
        .orderBy(desc(auditEvent.id))
        .limit(1);
      expect(event?.actor).toBe(`staff:${superAdmin.id}`);
    } finally {
      await withActor(db, tests, (tx) =>
        tx
          .update(centre)
          .set({ phone: original?.phone ?? null })
          .where(eq(centre.id, centreIds.hsrLayout)),
      );
    }
    await expect(
      as(manager, (tx) =>
        tx.insert(centre).values({ name: 'Not allowed', colour: seedCentres[0]?.colour ?? '' }),
      ),
    ).rejects.toThrow();
  });

  it('only the Super Admin changes staff and their centres; staff cannot change themselves', async () => {
    const rename = (actor: StaffMember, target: StaffMember) =>
      as(actor, (tx) =>
        tx
          .update(staffUser)
          .set({ name: target.name })
          .where(eq(staffUser.id, target.id))
          .returning({ id: staffUser.id }),
      );
    expect(await rename(deskHsr, deskHsr)).toEqual([]);
    expect(await rename(manager, deskHsr)).toEqual([]);
    expect(await rename(superAdmin, deskHsr)).toHaveLength(1);

    const assignment = { staffUserId: deskHsr.id, centreId: centreIds.whitefield };
    await expect(
      as(manager, (tx) => tx.insert(staffUserCentre).values(assignment)),
    ).rejects.toThrow();
    await as(superAdmin, (tx) => tx.insert(staffUserCentre).values(assignment));
    const removed = await as(superAdmin, (tx) =>
      tx
        .delete(staffUserCentre)
        .where(
          and(
            eq(staffUserCentre.staffUserId, deskHsr.id),
            eq(staffUserCentre.centreId, centreIds.whitefield),
          ),
        )
        .returning({ staff: staffUserCentre.staffUserId }),
    );
    expect(removed).toHaveLength(1);
  });

  it('nobody deletes staff or centres, not even the Super Admin', async () => {
    const deletedStaff = await as(superAdmin, (tx) =>
      tx.delete(staffUser).where(eq(staffUser.id, deskHsr.id)).returning({ id: staffUser.id }),
    );
    const deletedCentres = await as(superAdmin, (tx) =>
      tx.delete(centre).where(eq(centre.id, centreIds.hsrLayout)).returning({ id: centre.id }),
    );
    expect([deletedStaff, deletedCentres]).toEqual([[], []]);
  });

  it('only the Super Admin changes settings', async () => {
    const touch = (actor: StaffMember) =>
      as(actor, (tx) =>
        tx
          .update(setting)
          .set({ value: sql`${setting.value}` })
          .where(eq(setting.key, 'day.running_late_minutes'))
          .returning({ key: setting.key }),
      );
    expect(await touch(manager)).toEqual([]);
    expect(await touch(finance)).toEqual([]);
    expect(await touch(superAdmin)).toHaveLength(1);
  });

  it('tasks are closed by the people they are for', async () => {
    const close = (actor: StaffMember, id: string) =>
      as(actor, (tx) =>
        tx
          .update(task)
          .set({ status: 'closed', decision: 'Done in the RLS test', closedAt: new Date() })
          .where(inArray(task.id, [id]))
          .returning({ id: task.id }),
      );
    expect(await close(deskHsr, taskIds.financeRole)).toEqual([]);
    expect(await close(physioHsr, taskIds.physioWhitefield)).toEqual([]);
    expect(await close(deskHsr, taskIds.deskRole)).toHaveLength(1);
  });
});
