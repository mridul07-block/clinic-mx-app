import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import {
  appointmentTypeList,
  insertAppointmentType,
  lengthFor,
  physioLengths,
  setPhysioLengths,
  updateAppointmentType,
} from '../appointment-types';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { appointmentType, auditEvent, setting } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';

// SET-03 done when: length per type and per physio. Every staff member reads the types and
// lengths; only the Super Admin changes them; every change is audited. Each test runs in a
// transaction that is rolled back, so the seeded types never change. CI only.
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
const finance = member('finance@clinicmx.test');
const manager = member('manager@clinicmx.test');
const desk = member('desk.hsr@clinicmx.test');
const physio = member('physio.hsr@clinicmx.test');
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

/** Reads as the database owner inside the person's transaction, then goes back to their role. */
async function asOwner<R>(tx: Tx, read: () => Promise<R>): Promise<R> {
  await tx.execute(sql`reset role`);
  const result = await read();
  await tx.execute(sql`set local role authenticated`);
  return result;
}

const typeId = async (tx: Tx, key: string) => {
  const found = (await appointmentTypeList(tx)).find((type) => type.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found.id;
};

describe('appointment types', () => {
  it('start with the PRD’s four and their lengths', async () => {
    await rolledBack(desk, async (tx) => {
      const types = await appointmentTypeList(tx);
      expect(
        Object.fromEntries(
          ['consultation', 'session', 'review', 'zero_gravity_treadmill'].map((key) => [
            key,
            types.find((type) => type.key === key)?.minutes,
          ]),
        ),
      ).toEqual({ consultation: 45, session: 45, review: 45, zero_gravity_treadmill: 30 });
    });
  });

  it('replace the retired length settings, and the calendar slot is a setting', async () => {
    const keys = (
      await db
        .select({ key: setting.key })
        .from(setting)
        .where(
          inArray(setting.key, [
            'scheduling.consultation_minutes',
            'scheduling.session_minutes',
            'scheduling.slot_minutes',
          ]),
        )
    ).map((row) => row.key);
    expect(keys).toEqual(['scheduling.slot_minutes']);
  });

  it('are read by every staff role', async () => {
    for (const person of [superAdmin, finance, manager, desk, physio, support]) {
      await rolledBack(person, async (tx) => {
        expect((await appointmentTypeList(tx)).length, person.email).toBeGreaterThanOrEqual(4);
      });
    }
  });

  it('give a physio’s own length, else the type’s, and audit each change', async () => {
    await rolledBack(superAdmin, async (tx) => {
      const session = await typeId(tx, 'session');
      const review = await typeId(tx, 'review');
      expect(await lengthFor(tx, physio.id, session)).toBe(45);
      await setPhysioLengths(tx, physio.id, [
        { appointmentTypeId: session, minutes: 60 },
        { appointmentTypeId: review, minutes: null },
      ]);
      expect(await lengthFor(tx, physio.id, session)).toBe(60);
      expect(await lengthFor(tx, physio.id, review)).toBe(45);
      expect(await lengthFor(tx, desk.id, session)).toBe(45);
      // Changing, then clearing back to the type's length.
      await setPhysioLengths(tx, physio.id, [{ appointmentTypeId: session, minutes: 30 }]);
      expect(await lengthFor(tx, physio.id, session)).toBe(30);
      await setPhysioLengths(tx, physio.id, [{ appointmentTypeId: session, minutes: null }]);
      expect((await physioLengths(tx, physio.id)).size).toBe(0);
      expect(await lengthFor(tx, physio.id, session)).toBe(45);
      const events = await asOwner(tx, () =>
        tx
          .select({ action: auditEvent.action, actor: auditEvent.actor })
          .from(auditEvent)
          .where(
            and(
              eq(auditEvent.entity, 'physio_appointment_length'),
              sql`coalesce(${auditEvent.after}, ${auditEvent.before})->>'staff_user_id' = ${physio.id}`,
            ),
          )
          .orderBy(auditEvent.id),
      );
      expect(events.map((e) => e.action)).toEqual(['insert', 'update', 'delete']);
      expect(new Set(events.map((e) => e.actor))).toEqual(new Set([`staff:${superAdmin.id}`]));

      expect(await updateAppointmentType(tx, review, { name: 'Review', minutes: 30 })).toBe(true);
      const [event] = await asOwner(tx, () =>
        tx
          .select({ actor: auditEvent.actor, after: auditEvent.after })
          .from(auditEvent)
          .where(and(eq(auditEvent.entity, 'appointment_type'), eq(auditEvent.entityId, review)))
          .orderBy(desc(auditEvent.id))
          .limit(1),
      );
      expect(event?.actor).toBe(`staff:${superAdmin.id}`);
      expect((event?.after as { minutes: number }).minutes).toBe(30);
    });
  });

  it('are changed by nobody else, nor by Velyx support', async () => {
    for (const person of [finance, manager, desk, physio, support]) {
      const refused = person.support ? '25006' : '42501';
      await rolledBack(person, async (tx) => {
        const session = await typeId(tx, 'session');
        expect(
          await failure(tx, (sp) =>
            insertAppointmentType(sp, { key: 'test_visit', name: 'Test visit', minutes: 60 }),
          ),
          person.email,
        ).toBe(refused);
        expect(
          await failure(tx, (sp) =>
            setPhysioLengths(sp, physio.id, [{ appointmentTypeId: session, minutes: 60 }]),
          ),
          person.email,
        ).toBe(refused);
        expect(
          await failure(tx, (sp) =>
            sp
              .update(appointmentType)
              .set({ minutes: 15 })
              .where(eq(appointmentType.key, 'session')),
          ),
          person.email,
        ).toBe(person.support ? '25006' : undefined);
        expect(await lengthFor(tx, physio.id, session), person.email).toBe(45);
      });
    }
  });

  it('refuse a length of zero, a name in use and deletes', async () => {
    await rolledBack(superAdmin, async (tx) => {
      expect(
        await failure(tx, (sp) =>
          insertAppointmentType(sp, { key: 'test_zero', name: 'Zero', minutes: 0 }),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          insertAppointmentType(sp, { key: 'test_review', name: 'REVIEW', minutes: 45 }),
        ),
      ).toBe('23505');
      const deleted = await tx
        .delete(appointmentType)
        .where(eq(appointmentType.key, 'review'))
        .returning({ id: appointmentType.id });
      expect(deleted).toEqual([]);
    });
  });
});
