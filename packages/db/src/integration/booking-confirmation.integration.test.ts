import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { appointmentForConfirmation } from '../clinic-messages';
import { createDb } from '../client';
import { insertPatient } from '../patients';
import { job, priceItem, staffUser } from '../schema';
import { centreIds, seedStaff } from '../seed/data';
import { bookAppointment } from '../slots';
import { fakePatientDetails } from './fake-patients';
import { on, testPhysio, typeId } from './fake-schedule';

// WA-07: every booking not in a plan series queues one booking confirmation, whoever made it, and
// the sender reads what it says. In transactions rolled back. CI only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

const admin = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test');
if (!admin?.id) throw new Error('seed has no Super Admin');
const adminId = admin.id;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}
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

describe('the booking confirmation', () => {
  it('is queued once for each booking, on WhatsApp or by the clinic', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        consultant: true,
        createdBy: adminId,
      });
      const patient = await insertPatient(tx, fakePatientDetails());
      const consultation = await typeId(tx, 'consultation');
      const book = (minutes: number, channel: 'whatsapp' | 'front_desk' | 'walk_in') =>
        bookAppointment(tx, {
          centreId: centreIds.hsrLayout,
          physioId: physio.id,
          appointmentTypeId: consultation,
          startsAt: on(minutes),
          holder: 'test:booking-confirmation',
          patientId: patient.id,
          channel,
          ...(channel === 'whatsapp' ? {} : { bookedBy: adminId }),
          step: 15,
          now: new Date(),
        });
      const booked = [
        await book(9 * 60, 'whatsapp'),
        await book(10 * 60, 'front_desk'),
        await book(11 * 60, 'walk_in'),
      ];
      const keys = booked.map((row) => ['whatsapp.booking_confirmation', row.id].join(':'));
      const queued = await tx
        .select({ kind: job.kind, payload: job.payload, key: job.idempotencyKey })
        .from(job)
        .where(inArray(job.idempotencyKey, keys));
      expect(queued.sort((a, b) => keys.indexOf(a.key ?? '') - keys.indexOf(b.key ?? ''))).toEqual(
        booked.map((row, index) => ({
          kind: 'whatsapp.booking_confirmation',
          payload: { appointmentId: row.id },
          key: keys[index],
        })),
      );
    });
  });

  it('reads the appointment, the physio’s consultation fee and the centre’s details', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        consultant: true,
        createdBy: adminId,
      });
      const patient = await insertPatient(tx, fakePatientDetails());
      const [fee] = await tx.select().from(priceItem).where(eq(priceItem.key, 'consultation'));
      if (!fee) throw new Error('no consultation price item');
      await tx
        .update(staffUser)
        .set({ consultationPriceItemId: fee.id })
        .where(eq(staffUser.id, physio.id));
      const startsAt = on(12 * 60);
      const row = await bookAppointment(tx, {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: await typeId(tx, 'consultation'),
        startsAt,
        holder: 'test:booking-confirmation',
        patientId: patient.id,
        channel: 'front_desk',
        bookedBy: adminId,
        step: 15,
        now: new Date(),
      });
      const found = await appointmentForConfirmation(tx, row.id);
      expect(found).toMatchObject({
        patientId: patient.id,
        number: row.number,
        status: 'booked',
        channel: 'front_desk',
        startsAt,
        typeKey: 'consultation',
        physioName: physio.name,
        consultationFeePaise: fee.amountPaise,
        centreName: 'HSR Layout',
      });
      expect(found).toHaveProperty('mapLink');
      expect(found).toHaveProperty('centrePhone');

      await tx
        .update(staffUser)
        .set({ consultationPriceItemId: null })
        .where(eq(staffUser.id, physio.id));
      expect((await appointmentForConfirmation(tx, row.id))?.consultationFeePaise).toBeNull();
      expect(await appointmentForConfirmation(tx, crypto.randomUUID())).toBeUndefined();
    });
  });
});
