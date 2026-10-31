import { TEMPLATE_LANGUAGE } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { queueMessage, recordMessageOutcome } from '../messaging';
import { insertPatient } from '../patients';
import { auditEvent, message, messageFollowUp } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { bookAppointment } from '../slots';
import { followUpUndelivered, undeliveredMessages } from '../undelivered';
import { fakePatientDetails } from './fake-patients';
import { becomeStaff, on, testPhysio, typeId } from './fake-schedule';

// WA-13: the front desk's "Not delivered" list: Failed messages to known patients, for the centre
// they concern, for the set days, until Done; for those who run Today there, never for support.
// In transactions rolled back. Generated numbers and names only. CI only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

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
const deskHsr = member('desk.hsr@clinicmx.test');
const admin = member('super.admin@clinicmx.test');

/** A message to the patient, then Meta's outcome for it. */
async function sent(
  tx: Tx,
  to: { id: string; phone: string },
  outcome: 'failed' | 'skipped' | 'sent',
  extra: { appointmentId?: string } = {},
): Promise<string> {
  const id = await queueMessage(tx, {
    patientId: to.id,
    toPhone: to.phone,
    kind: 'template',
    templateKey: 'booking_confirmation',
    templateVersion: 2,
    language: TEMPLATE_LANGUAGE,
    variables: {},
    createdBy: 'system:whatsapp',
    appointmentId: extra.appointmentId ?? null,
  });
  await recordMessageOutcome(
    tx,
    id,
    outcome === 'sent'
      ? { status: 'sent', waMessageId: ['wamid.test', crypto.randomUUID()].join('-') }
      : {
          status: outcome,
          errorCode: outcome === 'failed' ? '131026' : 'not_approved',
          errorTitle: outcome === 'failed' ? 'Message undeliverable' : 'Not approved',
        },
  );
  return id;
}

async function patientAt(tx: Tx, centreId: string) {
  const details = fakePatientDetails(centreId);
  return { ...(await insertPatient(tx, details)), phone: details.phone };
}

/** What `as` sees on Today at the centre, then back to the owner. */
async function seen(tx: Tx, as: StaffMember, centreId: string): Promise<string[]> {
  await becomeStaff(tx, as);
  const ids = (await undeliveredMessages(tx, centreId)).map((row) => row.id);
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
  return ids;
}

describe('the front desk’s Not delivered list', () => {
  it('holds Failed messages only, at the patient’s centre, with the patient', async () => {
    await rolledBack(async (tx) => {
      const patient = await patientAt(tx, centreIds.hsrLayout);
      const failed = await sent(tx, patient, 'failed');
      const notSent = await sent(tx, patient, 'skipped');
      const delivered = await sent(tx, patient, 'sent');
      await becomeStaff(tx, deskHsr);
      const list = await undeliveredMessages(tx, centreIds.hsrLayout);
      const ours = list.filter((row) => [failed, notSent, delivered].includes(row.id));
      expect(ours).toEqual([
        {
          id: failed,
          patientId: patient.id,
          patientName: expect.any(String) as string,
          patientNumber: expect.any(String) as string,
          templateKey: 'booking_confirmation',
          kind: 'template',
          failedAt: expect.any(Date) as Date,
          errorCode: '131026',
          errorTitle: 'Message undeliverable',
          appointmentId: null,
        },
      ]);
    });
  });

  it('is for the appointment’s centre, else the patient’s own', async () => {
    await rolledBack(async (tx) => {
      const patient = await patientAt(tx, centreIds.hsrLayout);
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.koramangala],
        createdBy: admin.id,
      });
      const visit = await bookAppointment(tx, {
        centreId: centreIds.koramangala,
        physioId: physio.id,
        appointmentTypeId: await typeId(tx, 'session'),
        startsAt: on(10 * 60),
        holder: 'test:undelivered',
        patientId: patient.id,
        channel: 'front_desk',
        bookedBy: admin.id,
        step: 15,
        now: new Date(),
      });
      const about = await sent(tx, patient, 'failed', { appointmentId: visit.id });
      const general = await sent(tx, patient, 'failed');
      expect(await seen(tx, admin, centreIds.koramangala)).toContain(about);
      expect(await seen(tx, admin, centreIds.koramangala)).not.toContain(general);
      expect(await seen(tx, admin, centreIds.hsrLayout)).toContain(general);
      expect(await seen(tx, admin, centreIds.hsrLayout)).not.toContain(about);
    });
  });

  it('leaves out one older than the set days', async () => {
    await rolledBack(async (tx) => {
      const patient = await patientAt(tx, centreIds.hsrLayout);
      const old = await sent(tx, patient, 'failed');
      await tx
        .update(message)
        .set({ statusAt: sql`now() - interval '8 days'` })
        .where(eq(message.id, old));
      expect(await seen(tx, deskHsr, centreIds.hsrLayout)).not.toContain(old);
    });
  });

  it('shows only to those who run Today at the centre, never to support', async () => {
    await rolledBack(async (tx) => {
      const patient = await patientAt(tx, centreIds.hsrLayout);
      const failed = await sent(tx, patient, 'failed');
      expect(await seen(tx, deskHsr, centreIds.hsrLayout)).toContain(failed);
      expect(await seen(tx, member('manager@clinicmx.test'), centreIds.hsrLayout)).toContain(
        failed,
      );
      for (const email of [
        'desk.koramangala@clinicmx.test',
        'physio.hsr@clinicmx.test',
        'finance@clinicmx.test',
        'support.velyx@clinicmx.test',
      ]) {
        expect(await seen(tx, member(email), centreIds.hsrLayout)).toEqual([]);
      }
      // Nobody signed in reads the table itself: no rights at all.
      await becomeStaff(tx, deskHsr);
      await expect(tx.transaction((sp) => sp.select().from(messageFollowUp))).rejects.toMatchObject(
        { cause: { code: '42501' } },
      );
      await tx.execute(sql`reset role`);
    });
  });

  it('marks one Done as the person, once, and only one they may see', async () => {
    await rolledBack(async (tx) => {
      const patient = await patientAt(tx, centreIds.hsrLayout);
      const failed = await sent(tx, patient, 'failed');
      const delivered = await sent(tx, patient, 'sent');

      // Another centre's desk, and support, cannot.
      for (const email of ['desk.koramangala@clinicmx.test', 'support.velyx@clinicmx.test']) {
        await becomeStaff(tx, member(email));
        expect(await followUpUndelivered(tx, failed)).toBe(false);
        await tx.execute(sql`reset role`);
      }
      await becomeStaff(tx, deskHsr);
      expect(await followUpUndelivered(tx, delivered)).toBe(false);
      expect(await followUpUndelivered(tx, failed)).toBe(true);
      expect(await followUpUndelivered(tx, failed)).toBe(false);
      expect((await undeliveredMessages(tx, centreIds.hsrLayout)).map((r) => r.id)).not.toContain(
        failed,
      );
      await tx.execute(sql`reset role`);

      const [done] = await tx.select().from(messageFollowUp).where(eq(messageFollowUp.id, failed));
      expect(done?.followedUpBy).toBe(deskHsr.id);
      const events = await tx
        .select({ actor: auditEvent.actor, action: auditEvent.action })
        .from(auditEvent)
        .where(eq(auditEvent.entityId, failed));
      expect(events).toContainEqual({ actor: ['staff', deskHsr.id].join(':'), action: 'insert' });
    });
  });
});
