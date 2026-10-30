import { TEMPLATE_LANGUAGE, istInstant } from '@clinic-mx/schemas';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { queueMessageOnce } from '../messaging';
import { insertPatient } from '../patients';
import {
  DAY_BEFORE_REMINDERS_JOB,
  confirmAppointment,
  messageQueuedFor,
  queueNextReminders,
  remindableAppointments,
} from '../reminders';
import { appointment, job, message } from '../schema';
import { centreIds, seedStaff } from '../seed/data';
import { appointmentRecord, bookAppointment, changeAppointment } from '../slots';
import { fakePatientDetails } from './fake-patients';
import { on, testDate, testPhysio, typeId } from './fake-schedule';

// WA-08: the appointments a reminder run covers, the Confirm on the day before reminder, the
// reminder's appointment on its message, and the daily runs queued once per date. In transactions
// rolled back. CI only.
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

async function day(tx: Tx) {
  const physio = await testPhysio(tx, { centreIds: [centreIds.hsrLayout], createdBy: adminId });
  const details = fakePatientDetails();
  const patient = { ...(await insertPatient(tx, details)), phone: details.phone };
  const session = await typeId(tx, 'session');
  const book = (minutes: number) =>
    bookAppointment(tx, {
      centreId: centreIds.hsrLayout,
      physioId: physio.id,
      appointmentTypeId: session,
      startsAt: on(minutes),
      holder: 'test:reminders',
      patientId: patient.id,
      channel: 'whatsapp',
      step: 15,
      now: new Date(),
    });
  return { physio, patient, book };
}

const ofPhysio = (rows: { id: string }[], ids: string[]) =>
  rows.map((row) => row.id).filter((id) => ids.includes(id));

describe('the appointments a reminder run covers', () => {
  it('are the date’s Booked and Confirmed ones not yet started, soonest first', async () => {
    await rolledBack(async (tx) => {
      const { book } = await day(tx);
      const late = await book(12 * 60);
      const early = await book(9 * 60);
      const confirmed = await book(10 * 60);
      await confirmAppointment(tx, confirmed.id, new Date());
      const cancelled = await book(11 * 60);
      await changeAppointment(tx, {
        appointmentId: cancelled.id,
        status: 'cancelled',
        reason: 'clinic',
        changedBy: adminId,
        now: new Date(),
      });
      const ids = [late.id, early.id, confirmed.id, cancelled.id];
      expect(ofPhysio(await remindableAppointments(tx, testDate, new Date()), ids)).toEqual([
        early.id,
        confirmed.id,
        late.id,
      ]);
      // On the morning, those started by now are left out.
      expect(ofPhysio(await remindableAppointments(tx, testDate, on(9 * 60 + 30)), ids)).toEqual([
        confirmed.id,
        late.id,
      ]);
      expect(await remindableAppointments(tx, '2000-01-01', new Date(0))).toEqual([]);
      const [first] = await remindableAppointments(tx, testDate, on(11 * 60 + 59));
      expect(first).toMatchObject({ typeName: 'Session', centreName: 'HSR Layout' });
    });
  });
});

describe('the reminder’s Confirm', () => {
  it('confirms a Booked appointment once, with when; a changed or started one is not', async () => {
    await rolledBack(async (tx) => {
      const { book } = await day(tx);
      const visit = await book(10 * 60);
      const now = new Date();
      expect(await confirmAppointment(tx, visit.id, now)).toMatchObject({
        outcome: 'confirmed',
        centreId: centreIds.hsrLayout,
      });
      const [row] = await tx.select().from(appointment).where(eq(appointment.id, visit.id));
      expect(row).toMatchObject({ status: 'confirmed', confirmedAt: now });
      expect((await confirmAppointment(tx, visit.id, now)).outcome).toBe('already');

      const moved = await book(11 * 60);
      await changeAppointment(tx, {
        appointmentId: moved.id,
        status: 'cancelled',
        reason: 'patient',
        changedBy: adminId,
        now,
      });
      expect((await confirmAppointment(tx, moved.id, now)).outcome).toBe('changed');
      expect((await appointmentRecord(tx, moved.id))?.status).toBe('cancelled');

      const started = await book(12 * 60);
      expect((await confirmAppointment(tx, started.id, on(12 * 60 + 5))).outcome).toBe('changed');
      expect((await appointmentRecord(tx, started.id))?.status).toBe('booked');
      expect((await confirmAppointment(tx, crypto.randomUUID(), now)).outcome).toBe('changed');
    });
  });
});

describe('a reminder’s message', () => {
  it('names its appointment, is queued once per source, and outlives a removed appointment', async () => {
    await rolledBack(async (tx) => {
      const { patient, book } = await day(tx);
      const visit = await book(10 * 60);
      const sourceKey = `whatsapp.day_before_reminder:${visit.id}`;
      const values = {
        patientId: patient.id,
        toPhone: patient.phone,
        kind: 'template' as const,
        templateKey: 'day_before_reminder',
        templateVersion: 1,
        language: TEMPLATE_LANGUAGE,
        variables: { patient_name: 'Test' },
        createdBy: 'system:whatsapp',
        appointmentId: visit.id,
        sourceKey,
      };
      const id = await queueMessageOnce(tx, values);
      expect(id).toBeTruthy();
      expect(await queueMessageOnce(tx, values)).toBeNull();
      expect(await messageQueuedFor(tx, sourceKey)).toBe(true);
      expect(await messageQueuedFor(tx, `${sourceKey}x`)).toBe(false);
      const read = async () =>
        (
          await tx
            .select()
            .from(message)
            .where(eq(message.id, id ?? ''))
        )[0]?.appointmentId;
      expect(await read()).toBe(visit.id);
      // Only tests remove appointments: the message stays, without it.
      await tx.delete(appointment).where(eq(appointment.id, visit.id));
      expect(await read()).toBeNull();
    });
  });
});

describe('the reminders’ daily runs', () => {
  it('queue the next run once per date, at the setting’s time', async () => {
    await rolledBack(async (tx) => {
      const now = istInstant('2031-03-01', 19 * 60);
      const next = await queueNextReminders(
        tx,
        DAY_BEFORE_REMINDERS_JOB,
        '2031-03-02',
        '18:00',
        now,
      );
      expect(next).toBe('2031-03-03');
      await queueNextReminders(tx, DAY_BEFORE_REMINDERS_JOB, '2031-03-02', '18:00', now);
      const rows = await tx
        .select()
        .from(job)
        .where(eq(job.idempotencyKey, `${DAY_BEFORE_REMINDERS_JOB}:2031-03-03`));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        payload: { date: '2031-03-03' },
        runAt: istInstant('2031-03-02', 18 * 60),
      });
    });
  });
});
