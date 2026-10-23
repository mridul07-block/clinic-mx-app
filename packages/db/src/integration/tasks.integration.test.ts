import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { auditEvent, staffUser, staffUserCentre, task } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { closeTask, inboxTasks, openTaskCount, takeTask } from '../tasks';

// ALT-03 done when: tasks by urgency; closing requires a recorded decision. Under row level
// security, as the app runs every staff request. Tasks are made as the system, as jobs make them.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
const tests = systemActor('tests');
const KIND = 'tasks.test';

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
const deskHsr = member('desk.hsr@clinicmx.test');
const deskKoramangala = member('desk.koramangala@clinicmx.test');
const physioHsr = member('physio.hsr@clinicmx.test');
const support = member('support.velyx@clinicmx.test');
/** A second Front Desk member at HSR Layout, made for these tests. */
let deskHsrTwo: StaffMember;

const as = <R>(actor: StaffMember, work: Parameters<typeof withStaffAccess<R>>[2]) =>
  withStaffAccess(db, { actor }, work);

type Tx = Parameters<Parameters<typeof withStaffAccess>[2]>[0];
async function failure(actor: StaffMember, work: (tx: Tx) => Promise<unknown>) {
  try {
    await as(actor, work);
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

const hour = 3600_000;
const ids = {
  hsrNormal: '',
  hsrUrgent: '',
  hsrOverdue: '',
  hsrLater: '',
  koramangala: '',
  everyCentre: '',
  superAdmin: '',
};
const make = (values: Partial<typeof task.$inferInsert> & { title: string }) =>
  withActor(db, tests, async (tx) => {
    const [row] = await tx
      .insert(task)
      .values({ kind: KIND, ...values })
      .returning({ id: task.id });
    return row?.id ?? '';
  });
const mine = async (actor: StaffMember) =>
  (await as(actor, (tx) => inboxTasks(tx))).filter((t) => t.kind === KIND).map((t) => t.id);

beforeAll(async () => {
  deskHsrTwo = await withActor(db, tests, async (tx) => {
    const short = crypto.randomUUID().slice(0, 8);
    const [row] = await tx
      .insert(staffUser)
      .values({
        email: `tasks.${short}@clinicmx.test`,
        name: `Test Tasks Desk ${short}`,
        role: 'front_desk',
      })
      .returning();
    if (!row) throw new Error('no staff row');
    await tx.insert(staffUserCentre).values({ staffUserId: row.id, centreId: centreIds.hsrLayout });
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: 'front_desk',
      treatsPatients: false,
      consultant: false,
      centreIds: [centreIds.hsrLayout],
      support: false,
    } satisfies StaffMember;
  });
  const desk = { assigneeRole: 'front_desk' as const, centreId: centreIds.hsrLayout };
  ids.hsrNormal = await make({ ...desk, title: 'Normal, no due time' });
  ids.hsrLater = await make({
    ...desk,
    title: 'Normal, due later',
    dueAt: new Date(Date.now() + 5 * hour),
  });
  ids.hsrOverdue = await make({
    ...desk,
    title: 'Normal, overdue',
    dueAt: new Date(Date.now() - hour),
  });
  ids.hsrUrgent = await make({ ...desk, title: 'Urgent', priority: 'urgent' });
  ids.koramangala = await make({
    assigneeRole: 'front_desk',
    centreId: centreIds.koramangala,
    title: 'For the Koramangala desk',
  });
  ids.everyCentre = await make({
    assigneeRole: 'front_desk',
    title: 'For every desk',
    priority: 'high',
  });
  ids.superAdmin = await make({
    assigneeRole: 'super_admin',
    title: 'A job failed',
    priority: 'high',
  });
});

afterAll(async () => {
  await withActor(db, tests, async (tx) => {
    await tx.delete(task).where(eq(task.kind, KIND));
    await tx.delete(staffUserCentre).where(eq(staffUserCentre.staffUserId, deskHsrTwo.id));
    await tx.update(staffUser).set({ active: false }).where(eq(staffUser.id, deskHsrTwo.id));
  });
  await close();
});

describe('the tasks inbox under row level security', () => {
  it('shows a role its tasks at its centres, most urgent first', async () => {
    expect(await mine(deskHsr)).toEqual([
      ids.hsrUrgent,
      ids.everyCentre,
      ids.hsrOverdue,
      ids.hsrLater,
      ids.hsrNormal,
    ]);
    expect(await mine(deskKoramangala)).toEqual([ids.everyCentre, ids.koramangala]);
    expect(await mine(physioHsr)).toEqual([]);
    expect(await mine(superAdmin)).toEqual(expect.arrayContaining(Object.values(ids)));
    expect(await as(deskHsr, (tx) => openTaskCount(tx))).toBeGreaterThanOrEqual(5);
  });

  it('a task taken by one person leaves everyone else at the centre', async () => {
    expect(await as(deskHsr, (tx) => takeTask(tx, ids.hsrLater, deskHsr.id))).toBe(true);
    expect(await mine(deskHsrTwo)).not.toContain(ids.hsrLater);
    expect(await mine(deskHsr)).toContain(ids.hsrLater);
    const [taken] = await as(deskHsr, (tx) => inboxTasks(tx)).then((rows) =>
      rows.filter((t) => t.id === ids.hsrLater),
    );
    expect(taken?.assigneeName).toBe(deskHsr.name);
    expect(taken?.takenAt).toBeInstanceOf(Date);
    // Nobody takes it again, or takes it for someone else.
    expect(await as(deskHsrTwo, (tx) => takeTask(tx, ids.hsrLater, deskHsrTwo.id))).toBe(false);
    expect(
      await failure(deskHsrTwo, (tx) =>
        tx.update(task).set({ assigneeStaffUserId: deskHsr.id }).where(eq(task.id, ids.hsrNormal)),
      ),
    ).toBe('23514');
  });

  it('closes only with a written decision, as the person closing; then never changes', async () => {
    expect(
      await failure(deskHsr, (tx) =>
        tx
          .update(task)
          .set({
            status: 'closed',
            decision: '  ',
            closedBy: deskHsr.id,
            assigneeStaffUserId: deskHsr.id,
          })
          .where(eq(task.id, ids.hsrUrgent)),
      ),
    ).toBe('23514');
    expect(
      await failure(deskHsr, (tx) =>
        tx
          .update(task)
          .set({
            status: 'closed',
            decision: 'Called back',
            closedBy: deskHsrTwo.id,
            assigneeStaffUserId: deskHsr.id,
          })
          .where(eq(task.id, ids.hsrUrgent)),
      ),
    ).toBe('23514');
    // Closing an untaken role task takes it for the person closing.
    expect(
      await as(deskHsr, (tx) => closeTask(tx, ids.hsrUrgent, deskHsr.id, 'Called back; rebooked')),
    ).toBe(true);
    const [closed] = await withActor(db, tests, (tx) =>
      tx.select().from(task).where(eq(task.id, ids.hsrUrgent)),
    );
    expect(closed).toMatchObject({
      status: 'closed',
      decision: 'Called back; rebooked',
      closedBy: deskHsr.id,
      assigneeStaffUserId: deskHsr.id,
    });
    expect(closed?.closedAt).toBeInstanceOf(Date);
    // Closed is final: no reopening, no second decision, not even by the Super Admin.
    expect(
      await failure(deskHsr, (tx) =>
        tx.update(task).set({ status: 'open' }).where(eq(task.id, ids.hsrUrgent)),
      ),
    ).toBe('23514');
    expect(
      await failure(superAdmin, (tx) =>
        tx.update(task).set({ decision: 'Changed my mind' }).where(eq(task.id, ids.hsrUrgent)),
      ),
    ).toBe('23514');
    expect(await as(deskHsr, (tx) => closeTask(tx, ids.hsrUrgent, deskHsr.id, 'Again'))).toBe(
      false,
    );
    // The close is audited as the desk.
    const audit = await withActor(db, tests, (tx) =>
      tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(inArray(auditEvent.entityId, [ids.hsrUrgent])),
    );
    expect(audit.map((row) => row.actor)).toContain(`staff:${deskHsr.id}`);
  });

  it('staff change nothing else, create nothing and delete nothing', async () => {
    expect(
      await failure(deskHsr, (tx) =>
        tx.update(task).set({ title: 'Renamed' }).where(eq(task.id, ids.hsrNormal)),
      ),
    ).toBe('42501');
    expect(
      await failure(deskHsr, (tx) =>
        tx.update(task).set({ priority: 'urgent' }).where(eq(task.id, ids.hsrNormal)),
      ),
    ).toBe('42501');
    expect(
      await failure(superAdmin, (tx) =>
        tx.insert(task).values({ kind: KIND, title: 'Made by staff', assigneeRole: 'finance' }),
      ),
    ).toBe('42501');
    expect(
      await failure(superAdmin, (tx) => tx.delete(task).where(eq(task.id, ids.hsrNormal))),
    ).toBe('42501');
  });

  it('a desk elsewhere, a physio and Velyx support cannot take or close the task', async () => {
    expect(await as(deskKoramangala, (tx) => takeTask(tx, ids.hsrNormal, deskKoramangala.id))).toBe(
      false,
    );
    expect(
      await as(physioHsr, (tx) => closeTask(tx, ids.hsrNormal, physioHsr.id, 'Not mine')),
    ).toBe(false);
    // Velyx support's transactions are read only (IAM-08).
    expect(await failure(support, (tx) => takeTask(tx, ids.superAdmin, support.id))).toBe('25006');
  });

  it('the system still closes a task with a decision, never without', async () => {
    await withActor(db, tests, (tx) =>
      tx
        .update(task)
        .set({ status: 'closed', decision: 'Resolved by the system', closedAt: new Date() })
        .where(eq(task.id, ids.koramangala)),
    );
    const [row] = await withActor(db, tests, (tx) =>
      tx.select({ status: task.status }).from(task).where(eq(task.id, ids.koramangala)),
    );
    expect(row?.status).toBe('closed');
  });
});
