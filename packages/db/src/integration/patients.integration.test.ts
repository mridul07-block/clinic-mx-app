import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  insertPatient,
  patientRecord,
  patientsOnPhone,
  searchPatients,
  updatePatient,
} from '../patients';
import { auditEvent, patient } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { fakePatientDetails, fakePatientId } from './fake-patients';

// SCH-01: patients in the database. Several share one mobile; OP numbers come from the
// registering centre's sequence, never repeat and never change; every signed in staff member
// reads every patient; only the Super Admin, Centre Managers and the Front Desk add and edit them.
// Most tests run in a transaction that is rolled back; patients a test commits are generated.
// CI database only.
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
const deskHsr = member('desk.hsr@clinicmx.test');
const physio = member('physio.koramangala@clinicmx.test');
const finance = member('finance@clinicmx.test');
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

const numberOf = (opNumber: string) => Number(opNumber.slice(opNumber.indexOf('-') + 1));

describe('patients', () => {
  it('share a mobile, each with their own OP number from the centre’s sequence', async () => {
    await rolledBack(deskHsr, async (tx) => {
      const first = fakePatientDetails(centreIds.hsrLayout);
      const a = await insertPatient(tx, first);
      const b = await insertPatient(tx, { ...first, name: `${first.name} sibling` });
      expect(a.opNumber).toMatch(/^HSR-\d{5}$/);
      expect(numberOf(b.opNumber)).toBe(numberOf(a.opNumber) + 1);
      expect((await patientsOnPhone(tx, first.phone)).map((p) => p.id)).toEqual(
        expect.arrayContaining([a.id, b.id]),
      );
      expect((await patientsOnPhone(tx, first.phone, a.id)).map((p) => p.id)).toEqual([b.id]);
    });
    await rolledBack(superAdmin, async (tx) => {
      const kor = await insertPatient(tx, fakePatientDetails(centreIds.koramangala));
      expect(kor.opNumber).toMatch(/^KOR-\d{5}$/);
    });
  });

  it('give a rolled back number back, so numbers have no gaps', async () => {
    let rolledBackNumber = '';
    await rolledBack(deskHsr, async (tx) => {
      rolledBackNumber = (await insertPatient(tx, fakePatientDetails())).opNumber;
    });
    await rolledBack(deskHsr, async (tx) => {
      expect((await insertPatient(tx, fakePatientDetails())).opNumber).toBe(rolledBackNumber);
    });
  });

  it('never repeat a number when two are added at once', async () => {
    const second = createDb(url, { max: 1 });
    try {
      const add = (database: typeof db) =>
        withActor(database, systemActor('tests'), (tx) => insertPatient(tx, fakePatientDetails()));
      const [a, b] = await Promise.all([add(db), add(second.db)]);
      expect(a.opNumber).not.toBe(b.opNumber);
      expect(Math.abs(numberOf(a.opNumber) - numberOf(b.opNumber))).toBe(1);
    } finally {
      await second.close();
    }
  });

  it('ignore an OP number a caller gives, and keep it and the centre as issued', async () => {
    await rolledBack(superAdmin, async (tx) => {
      const [row] = await tx
        .insert(patient)
        .values({ ...fakePatientDetails(), opNumber: 'HSR-99999' })
        .returning({ id: patient.id, opNumber: patient.opNumber });
      if (!row) throw new Error('not inserted');
      expect(row.opNumber).not.toBe('HSR-99999');
      expect(
        await failure(tx, (sp) =>
          sp.update(patient).set({ opNumber: 'HSR-99999' }).where(eq(patient.id, row.id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(patient)
            .set({ registeredCentreId: centreIds.koramangala })
            .where(eq(patient.id, row.id)),
        ),
      ).toBe('23514');
    });
  });

  it('are read by every role in every centre, and found by mobile or name', async () => {
    const details = fakePatientDetails(centreIds.whitefield);
    const { id } = await withActor(db, systemActor('tests'), (tx) => insertPatient(tx, details));
    for (const reader of [superAdmin, manager, deskHsr, physio, finance, support]) {
      await rolledBack(reader, async (tx) => {
        expect((await patientRecord(tx, id))?.name, reader.email).toBe(details.name);
      });
    }
    await rolledBack(physio, async (tx) => {
      const byPhone = await searchPatients(tx, { kind: 'phone', digits: details.phone.slice(5) });
      expect(byPhone.map((p) => p.id)).toContain(id);
      const byName = await searchPatients(tx, { kind: 'name', text: details.name.toUpperCase() });
      expect(byName.map((p) => p.id)).toEqual([id]);
      // A % typed into the search is a letter, not a wildcard.
      expect(await searchPatients(tx, { kind: 'name', text: '%%%' })).toEqual([]);
    });
  });

  it('are added at a centre the person sees, by the roles that edit patients', async () => {
    await rolledBack(deskHsr, async (tx) => {
      expect(
        await failure(tx, (sp) => insertPatient(sp, fakePatientDetails(centreIds.koramangala))),
      ).toBe('42501');
    });
    for (const writer of [physio, finance]) {
      await rolledBack(writer, async (tx) => {
        expect(
          await failure(tx, (sp) => insertPatient(sp, fakePatientDetails(centreIds.koramangala))),
          writer.email,
        ).toBe('42501');
      });
    }
    await rolledBack(support, async (tx) => {
      expect(await failure(tx, (sp) => insertPatient(sp, fakePatientDetails()))).toBeDefined();
    });
  });

  it('are edited by those roles only, audited, and never deleted', async () => {
    const id = await fakePatientId(db);
    const details = { name: 'Test Patient renamed', phone: '+919900000099' };
    for (const reader of [physio, finance]) {
      await rolledBack(reader, async (tx) => {
        // Row level security hides the row from the update.
        expect(await updatePatient(tx, id, details), reader.email).toBe(false);
      });
    }
    await withStaffAccess(db, { actor: manager }, async (tx) => {
      expect(await updatePatient(tx, id, { ...details, sex: 'other' })).toBe(true);
      const deleted = await tx
        .delete(patient)
        .where(eq(patient.id, id))
        .returning({ id: patient.id });
      expect(deleted).toEqual([]);
    });
    // The audit trail is read on the owner connection: managers do not read patient events.
    const [event] = await db
      .select({ actor: auditEvent.actor, action: auditEvent.action, after: auditEvent.after })
      .from(auditEvent)
      .where(and(eq(auditEvent.entity, 'patient'), eq(auditEvent.entityId, id)))
      .orderBy(sql`${auditEvent.id} desc`)
      .limit(1);
    expect(event).toMatchObject({
      actor: `staff:${manager.id}`,
      action: 'update',
      after: { sex: 'other', name: details.name },
    });
    expect((await patientRecord(db, id))?.sex).toBe('other');
  });
});
