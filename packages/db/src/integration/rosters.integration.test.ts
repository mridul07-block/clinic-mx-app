import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  availabilityOn,
  cancelLeave,
  decideLeave,
  insertLeave,
  leaveFor,
  rosterOn,
  rosterVersions,
  saveRoster,
} from '../rosters';
import { auditEvent, roster, staffLeave } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';

// SET-04 done when: managers set rosters; physios request their own leave. Rosters are read by
// everyone who sees the centre; leave by the person and their managers; nobody decides their own.
// Each test runs in a transaction that is rolled back. CI only.
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
const desk = member('desk.hsr@clinicmx.test');
const physio = member('physio.hsr@clinicmx.test');
const physioWhitefield = member('physio.whitefield@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

/** Runs `work` as a staff member under RLS, in a transaction that is always rolled back. */
async function rolledBack(actor: StaffMember, work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withStaffAccess(db, { actor }, async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Switches to another person inside the same transaction (their claims and role). */
async function becomes(tx: Tx, actor: StaffMember) {
  const { claimsForStaff } = await import('../access');
  await tx.execute(sql`reset role`);
  const claims = JSON.stringify({ role: 'authenticated', clinic: claimsForStaff(actor) });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`select set_config('audit.actor', ${`staff:${actor.id}`}, true)`);
  await tx.execute(sql`set local role authenticated`);
}

/** The Postgres error code a statement failed with, inside a savepoint. */
async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

// A Monday a few weeks out, so tests never meet today's real rosters.
const monday = (() => {
  let date = addDays(istDate(new Date()), 21);
  while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) date = addDays(date, 1);
  return date;
})();
const weekly = (blocks = [{ starts: 540, ends: 780 }]) => [blocks, [], [], [], [], [], []];
const partLeave = (staffUserId: string, requestedBy: string, from = 600, to = 660) => ({
  staffUserId,
  startsAt: istInstant(monday, from),
  endsAt: istInstant(monday, to),
  allDay: false,
  note: null,
  status: 'requested' as const,
  requestedBy,
});

describe('rosters', () => {
  it('are set by managers in centres they see, and the version in effect applies', async () => {
    await rolledBack(manager, async (tx) => {
      await saveRoster(tx, {
        staffUserId: physio.id,
        centreId: centreIds.hsrLayout,
        effectiveFrom: monday,
        weekly: weekly(),
        createdBy: manager.id,
      });
      await saveRoster(tx, {
        staffUserId: physio.id,
        centreId: centreIds.hsrLayout,
        effectiveFrom: addDays(monday, 7),
        weekly: weekly([{ starts: 840, ends: 1080 }]),
        createdBy: manager.id,
      });
      expect(await rosterOn(tx, physio.id, monday)).toEqual([
        expect.objectContaining({ centreName: 'HSR Layout', blocks: [{ starts: 540, ends: 780 }] }),
      ]);
      expect((await rosterOn(tx, physio.id, addDays(monday, 7)))[0]?.blocks).toEqual([
        { starts: 840, ends: 1080 },
      ]);
      expect(await rosterOn(tx, physio.id, addDays(monday, 1))).toEqual([]);
      // Whitefield is not one of their centres.
      expect(
        await failure(tx, (sp) =>
          saveRoster(sp, {
            staffUserId: physioWhitefield.id,
            centreId: centreIds.whitefield,
            effectiveFrom: monday,
            weekly: weekly(),
            createdBy: manager.id,
          }),
        ),
      ).toBe('42501');

      // The front desk at the centre reads it; a physio elsewhere does not; nobody else writes.
      await becomes(tx, desk);
      expect((await rosterVersions(tx, physio.id)).length).toBe(2);
      await becomes(tx, physioWhitefield);
      expect(await rosterVersions(tx, physio.id)).toEqual([]);
      await becomes(tx, desk);
      expect(
        await failure(tx, (sp) =>
          saveRoster(sp, {
            staffUserId: physio.id,
            centreId: centreIds.hsrLayout,
            effectiveFrom: addDays(monday, 14),
            weekly: weekly(),
            createdBy: desk.id,
          }),
        ),
      ).toBe('42501');
    });
  });

  it('record each change in the audit as the manager', async () => {
    await rolledBack(superAdmin, async (tx) => {
      const id = await saveRoster(tx, {
        staffUserId: physio.id,
        centreId: centreIds.hsrLayout,
        effectiveFrom: monday,
        weekly: weekly(),
        createdBy: superAdmin.id,
      });
      const [event] = await tx
        .select({ actor: auditEvent.actor, action: auditEvent.action })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'roster'), eq(auditEvent.entityId, id)))
        .orderBy(desc(auditEvent.id))
        .limit(1);
      expect(event).toEqual({ actor: `staff:${superAdmin.id}`, action: 'insert' });
    });
  });
});

describe('leave', () => {
  it('is requested by the person, decided by a manager, never by themselves', async () => {
    await rolledBack(physio, async (tx) => {
      const id = await insertLeave(tx, partLeave(physio.id, physio.id));
      // Nobody requests leave for someone else, nor approves their own.
      expect(
        await failure(tx, (sp) => insertLeave(sp, partLeave(physioWhitefield.id, physio.id))),
      ).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          decideLeave(sp, id, { approve: true, decidedBy: physio.id, reason: null }),
        ),
      ).toBe('42501');

      await becomes(tx, desk);
      expect(await leaveFor(tx, physio.id)).toEqual([]);
      // Support's restrictive policy leaves no row to update.
      await becomes(tx, support);
      expect(
        await decideLeave(tx, id, { approve: true, decidedBy: support.id, reason: null }),
      ).toBe(false);
      await becomes(tx, manager);
      expect((await leaveFor(tx, physio.id)).map((l) => l.status)).toEqual(['requested']);
      expect(
        await decideLeave(tx, id, { approve: true, decidedBy: manager.id, reason: null }),
      ).toBe(true);
      const [row] = await tx
        .select({ status: staffLeave.status, decidedBy: staffLeave.decidedBy })
        .from(staffLeave)
        .where(eq(staffLeave.id, id));
      expect(row).toEqual({ status: 'approved', decidedBy: manager.id });
    });
  });

  it('never overlaps requested or approved leave, and cancelled leave frees the time', async () => {
    await rolledBack(physio, async (tx) => {
      const id = await insertLeave(tx, partLeave(physio.id, physio.id));
      expect(
        await failure(tx, (sp) => insertLeave(sp, partLeave(physio.id, physio.id, 630, 700))),
      ).toBe('23P01');
      expect(await cancelLeave(tx, id)).toBe(true);
      await insertLeave(tx, partLeave(physio.id, physio.id, 630, 700));
      // A declined decision needs its reason (the table's check).
      await becomes(tx, manager);
      const another = await insertLeave(tx, {
        ...partLeave(physio.id, manager.id, 900, 960),
        status: 'approved',
      });
      expect(
        await failure(tx, (sp) =>
          sp.update(staffLeave).set({ status: 'declined' }).where(eq(staffLeave.id, another)),
        ),
      ).toBe('23514');
    });
  });

  it('is cut out of the hours a person can be booked', async () => {
    await rolledBack(manager, async (tx) => {
      await saveRoster(tx, {
        staffUserId: physio.id,
        centreId: centreIds.hsrLayout,
        effectiveFrom: monday,
        weekly: weekly(),
        createdBy: manager.id,
      });
      await insertLeave(tx, { ...partLeave(physio.id, manager.id), status: 'approved' });
      expect(await availabilityOn(tx, physio.id, monday)).toEqual([
        {
          centreId: centreIds.hsrLayout,
          startsAt: istInstant(monday, 540),
          endsAt: istInstant(monday, 600),
        },
        {
          centreId: centreIds.hsrLayout,
          startsAt: istInstant(monday, 660),
          endsAt: istInstant(monday, 780),
        },
      ]);
      // Requested leave does not block bookings until it is approved.
      expect(await availabilityOn(tx, physio.id, addDays(monday, 7))).toHaveLength(1);
      expect(
        await tx.select({ id: roster.id }).from(roster).where(eq(roster.staffUserId, physio.id)),
      ).toHaveLength(1);
    });
  });
});
