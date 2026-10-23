import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { healthFormVisit } from '../intake';
import { insertPatientLink } from '../patient-links';
import { appointment, centre, patient, staffUser } from '../schema';
import { centreIds, seedStaff } from '../seed/data';
import { bookAppointment } from '../slots';
import { on, testPatient, testPhysio, typeId } from './fake-schedule';

// INT-03: a health form link reaches the form for its own appointment only. Under the link's
// patient access the page reads that appointment, the patient's name, its centre and its physio,
// and nothing else: no other appointment (the same patient's included), no other patient, centre
// or staff member, no column beyond the grant, and no change. Rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

const superAdminId = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test')?.id ?? '';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

/** Runs `work` as the test system (the owner, audited), in a transaction always rolled back. */
async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('tests'), async (tx) => {
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

/** From here on, read as the patient behind `link`, the way `withPatientAccess` does. */
async function becomePatient(
  tx: Tx,
  link: { id: string; patientId: string; purpose: string },
): Promise<void> {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: link.purpose },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

/** Two patients, three visits with a test physio at HSR, and a health form link for the first. */
async function visits(tx: Tx) {
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdminId,
  });
  const session = await typeId(tx, 'session');
  const patientId = await testPatient(tx);
  const otherPatientId = await testPatient(tx);
  const book = (forPatient: string, minutes: number) =>
    bookAppointment(tx, {
      centreId: centreIds.hsrLayout,
      physioId: physio.id,
      appointmentTypeId: session,
      patientId: forPatient,
      channel: 'front_desk',
      bookedBy: superAdminId,
      holder: 'test:intake',
      startsAt: on(minutes),
      step: 15,
      now: new Date(),
    });
  const mine = await book(patientId, 600);
  const later = await book(patientId, 720);
  const theirs = await book(otherPatientId, 660);
  const link = await insertPatientLink(tx, {
    patientId,
    purpose: 'health_form',
    appointmentId: mine.id,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [names] = await tx
    .select({ patientName: patient.name, centreName: centre.name })
    .from(patient)
    .innerJoin(centre, eq(centre.id, centreIds.hsrLayout))
    .where(eq(patient.id, patientId));
  return { physio, patientId, mine, later, theirs, link, names };
}

describe('a health form link under row level security', () => {
  it('reads its own visit: the appointment, the patient name, the centre and the physio', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, mine, link, names } = await visits(tx);
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await healthFormVisit(tx)).toEqual({
        appointmentId: mine.id,
        status: 'booked',
        startsAt: on(600),
        patientName: names?.patientName,
        centreName: names?.centreName,
        physioName: physio.name,
      });
      expect(await tx.select({ id: patient.id }).from(patient)).toEqual([{ id: patientId }]);
      expect(await tx.select({ id: centre.id }).from(centre)).toEqual([
        { id: centreIds.hsrLayout },
      ]);
      expect(await tx.select({ id: staffUser.id }).from(staffUser)).toEqual([{ id: physio.id }]);
    });
  });

  it('reads no other appointment, not even the same patient’s next visit', async () => {
    await rolledBack(async (tx) => {
      const { patientId, mine, link } = await visits(tx);
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await tx.select({ id: appointment.id }).from(appointment)).toEqual([{ id: mine.id }]);
    });
  });

  it('reads no column beyond the grant and changes nothing', async () => {
    await rolledBack(async (tx) => {
      const { patientId, mine, link } = await visits(tx);
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await failure(tx, (sp) => sp.select({ phone: patient.phone }).from(patient))).toBe(
        '42501',
      );
      expect(await failure(tx, (sp) => sp.select({ email: staffUser.email }).from(staffUser))).toBe(
        '42501',
      );
      expect(
        await failure(tx, (sp) =>
          sp.update(appointment).set({ status: 'cancelled' }).where(eq(appointment.id, mine.id)),
        ),
      ).toBe('42501');
    });
  });

  it('reaches no visit through a link without an appointment', async () => {
    await rolledBack(async (tx) => {
      const { patientId } = await visits(tx);
      const plan = await insertPatientLink(tx, {
        patientId,
        purpose: 'my_plan',
        episodeId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await becomePatient(tx, { id: plan.id, patientId, purpose: 'my_plan' });
      expect(await healthFormVisit(tx)).toBeUndefined();
      expect(await tx.select({ id: appointment.id }).from(appointment)).toEqual([]);
      expect(await tx.select({ id: staffUser.id }).from(staffUser)).toEqual([]);
    });
  });
});
