import { addDays, istDate, type EpisodeStatus } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { bookingCounterOf } from '../booking-counters';
import { createDb } from '../client';
import { insertEpisode, updateEpisodeState } from '../episodes';
import type { StaffMember } from '../identity';
import { insertOpeningEntry } from '../opening-entries';
import { insertPatient } from '../patients';
import { appointment, patientPackage, priceItem, staffUser, whatsappFlowSession } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { appointmentRecord, bookAppointment, changeAppointment } from '../slots';
import {
  consultationFees,
  createFlowSession,
  flowSessionRecord,
  movableAppointment,
  saveFlowState,
  upcomingAppointmentsOnPhone,
} from '../whatsapp-flows';
import { fakePatientDetails } from './fake-patients';
import { becomeStaff, on, testPhysio, typeId } from './fake-schedule';

// WA-04: the booking Flow's sessions are the server's alone and go after the retention days; a
// physio's consultation fee is read for the form. In transactions rolled back. CI only.
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
const everyone = [
  member('super.admin@clinicmx.test'),
  member('manager@clinicmx.test'),
  member('desk.hsr@clinicmx.test'),
  member('physio.hsr@clinicmx.test'),
  member('support.velyx@clinicmx.test'),
];

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

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

describe('booking Flow sessions', () => {
  it('keep what was picked, and are the server’s alone', async () => {
    await rolledBack(async (tx) => {
      const id = await createFlowSession(tx, {
        phone: '+919900000001',
        kind: 'booking',
        expiresAt: tomorrow(),
      });
      await saveFlowState(tx, id, { centreId: 'c', date: '2026-11-02' });
      expect((await flowSessionRecord(tx, id))?.state).toEqual({
        centreId: 'c',
        date: '2026-11-02',
      });
      for (const staff of everyone) {
        await becomeStaff(tx, staff);
        expect(
          await failure(tx, (sp) =>
            sp.select().from(whatsappFlowSession).where(eq(whatsappFlowSession.id, id)),
          ),
          staff.email,
        ).toBe('42501');
        await tx.execute(sql`reset role`);
      }
    });
  });

  it('need a number with its country code and a later expiry', async () => {
    await rolledBack(async (tx) => {
      const insert = (values: { phone: string; expiresAt: Date }) => (sp: Tx) =>
        createFlowSession(sp, { ...values, kind: 'booking' });
      expect(await failure(tx, insert({ phone: '9900000001', expiresAt: tomorrow() }))).toBe(
        '23514',
      );
      expect(await failure(tx, insert({ phone: '+919900000001', expiresAt: new Date(0) }))).toBe(
        '23514',
      );
    });
  });

  it('go once older than the retention days', async () => {
    await rolledBack(async (tx) => {
      const old = await createFlowSession(tx, {
        phone: '+919900000002',
        kind: 'booking',
        expiresAt: tomorrow(),
      });
      const fresh = await createFlowSession(tx, {
        phone: '+919900000003',
        kind: 'booking',
        expiresAt: tomorrow(),
      });
      const longAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
      await tx
        .update(whatsappFlowSession)
        .set({ createdAt: longAgo, expiresAt: new Date(longAgo.getTime() + 1000) })
        .where(eq(whatsappFlowSession.id, old));
      await tx.execute(sql`select internal.prune_whatsapp_flow_sessions()`);
      expect(await flowSessionRecord(tx, old)).toBeUndefined();
      expect(await flowSessionRecord(tx, fresh)).toBeDefined();
    });
  });
});

describe('consultation fees', () => {
  it('are each physio’s price item, and none where unset', async () => {
    await rolledBack(async (tx) => {
      const [fee] = await tx.select().from(priceItem).where(eq(priceItem.key, 'consultation'));
      if (!fee) throw new Error('no consultation price item');
      const physio = member('physio.hsr@clinicmx.test');
      await tx
        .update(staffUser)
        .set({ consultationPriceItemId: fee.id })
        .where(eq(staffUser.id, physio.id));
      const other = member('manager@clinicmx.test');
      await tx
        .update(staffUser)
        .set({ consultationPriceItemId: null })
        .where(eq(staffUser.id, other.id));
      const fees = await consultationFees(tx, [physio.id, other.id]);
      expect(fees.get(physio.id)).toEqual({ label: fee.label, amountPaise: fee.amountPaise });
      expect(fees.has(other.id)).toBe(false);
      expect((await consultationFees(tx, [])).size).toBe(0);
    });
  });
});

// WA-05: the reschedule Flow's sessions, the number's upcoming appointments, and the patient's own
// move recorded with no staff member, on WhatsApp, counted and charged to the package as any move
// asked by the patient.
const superAdmin = member('super.admin@clinicmx.test');

/** A test physio at HSR Layout, two patients sharing a number, one on another, and a booker. */
async function family(tx: Tx) {
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const phone = `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const first = await insertPatient(tx, { ...fakePatientDetails(), phone });
  const second = await insertPatient(tx, { ...fakePatientDetails(), phone });
  const stranger = await insertPatient(tx, fakePatientDetails());
  const session = await typeId(tx, 'session');
  const book = (patientId: string, minutes: number, episodeId?: string) =>
    bookAppointment(tx, {
      centreId: centreIds.hsrLayout,
      physioId: physio.id,
      appointmentTypeId: session,
      startsAt: on(minutes),
      holder: 'test:flow',
      patientId,
      episodeId,
      channel: 'whatsapp',
      step: 15,
      now: new Date(),
    });
  return { physio, phone, first, second, stranger, book };
}

const whatsappMove = (appointmentId: string) => ({
  appointmentId,
  status: 'rescheduled' as 'rescheduled' | 'cancelled',
  reason: 'patient' as 'patient' | 'clinic',
  changedBy: null as string | null,
  channel: 'whatsapp' as 'whatsapp' | undefined,
  now: new Date(),
});

describe('the reschedule Flow', () => {
  it('keeps a session naming the appointment, and refuses an unknown kind', async () => {
    await rolledBack(async (tx) => {
      const id = await createFlowSession(tx, {
        phone: '+919900000004',
        kind: 'reschedule',
        expiresAt: tomorrow(),
        state: { appointmentId: 'a', fixed: true },
      });
      expect(await flowSessionRecord(tx, id)).toMatchObject({
        kind: 'reschedule',
        state: { appointmentId: 'a', fixed: true },
      });
      expect(
        await failure(tx, (sp) =>
          sp.insert(whatsappFlowSession).values({
            phone: '+919900000004',
            kind: 'cancel',
            expiresAt: tomorrow(),
          }),
        ),
      ).toBe('23514');
    });
  });

  it('lists the number’s upcoming Booked or Confirmed appointments, everyone on it, soonest first', async () => {
    await rolledBack(async (tx) => {
      const { phone, first, second, stranger, book } = await family(tx);
      const later = await book(first.id, 11 * 60);
      const sooner = await book(second.id, 9 * 60);
      await book(stranger.id, 10 * 60);
      const cancelled = await book(first.id, 12 * 60);
      await changeAppointment(tx, {
        ...whatsappMove(cancelled.id),
        status: 'cancelled',
        changedBy: superAdmin.id,
        channel: undefined,
      });
      const listed = await upcomingAppointmentsOnPhone(tx, phone, new Date());
      expect(listed.map((v) => v.id)).toEqual([sooner.id, later.id]);
      expect(listed[0]).toMatchObject({ phone, typeKey: 'session', status: 'booked' });
      // Nothing once they have started.
      expect(await upcomingAppointmentsOnPhone(tx, phone, on(13 * 60))).toEqual([]);
      expect((await movableAppointment(tx, cancelled.id))?.status).toBe('cancelled');
    });
  });

  it('records the patient’s own move with no staff member, counted as by the patient', async () => {
    await rolledBack(async (tx) => {
      const { first, book } = await family(tx);
      const visit = await book(first.id, 10 * 60);
      expect(await changeAppointment(tx, whatsappMove(visit.id))).toEqual({ id: visit.id });
      expect(await appointmentRecord(tx, visit.id)).toMatchObject({
        status: 'rescheduled',
        changeReason: 'patient',
      });
      const [row] = await tx.select().from(appointment).where(eq(appointment.id, visit.id));
      expect(row).toMatchObject({ changedBy: null, changeChannel: 'whatsapp' });
      expect((await bookingCounterOf(tx, first.id)).reschedules).toBe(1);
    });
  });

  it('needs a staff member for any other change, and lets no signed in person claim WhatsApp', async () => {
    await rolledBack(async (tx) => {
      const { first, book } = await family(tx);
      const visit = await book(first.id, 10 * 60);
      const moved = (change: Partial<ReturnType<typeof whatsappMove>>) => (sp: Tx) =>
        changeAppointment(sp, { ...whatsappMove(visit.id), ...change });
      expect(await failure(tx, moved({ channel: undefined })), 'nobody').toBe('23514');
      expect(await failure(tx, moved({ reason: 'clinic' })), 'by the clinic').toBe('23514');
      expect(
        await failure(tx, moved({ changedBy: superAdmin.id })),
        'a staff member on WhatsApp',
      ).toBe('23514');
      // Nor may a booked appointment carry a reason with nobody recorded.
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({ changeReason: 'patient', changedAt: new Date() })
            .where(eq(appointment.id, visit.id)),
        ),
        'a reason, nobody',
      ).toBe('23514');
      await becomeStaff(tx, superAdmin);
      expect(await failure(tx, moved({})), 'signed in').toBe('42501');
      await tx.execute(sql`reset role`);
    });
  });

  it('uses a package session’s reschedule, and is refused with none left', async () => {
    await rolledBack(async (tx) => {
      const { physio, first, book } = await family(tx);
      const episodeId = await insertEpisode(tx, {
        patientId: first.id,
        centreId: centreIds.hsrLayout,
      });
      const path: EpisodeStatus[] = [
        'intake_pending',
        'awaiting_consultation',
        'plan_proposed',
        'active',
      ];
      for (let step = 1; step < path.length; step++) {
        await updateEpisodeState(tx, episodeId, path[step - 1] as EpisodeStatus, {
          status: path[step] as EpisodeStatus,
          pausedFrom: null,
        });
      }
      await becomeStaff(tx, superAdmin);
      await insertOpeningEntry(tx, {
        patientId: first.id,
        episodeId,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        sessionsLeft: 12,
        validUntil: addDays(istDate(new Date()), 60),
        by: superAdmin.id,
      });
      await tx.execute(sql`reset role`);
      await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
      const left = async () =>
        (
          await tx
            .select({ left: patientPackage.reschedulesLeft })
            .from(patientPackage)
            .where(eq(patientPackage.episodeId, episodeId))
        )[0]?.left;
      expect(await left()).toBe(1);
      const firstMove = await book(first.id, 9 * 60, episodeId);
      await changeAppointment(tx, whatsappMove(firstMove.id));
      expect(await left()).toBe(0);
      const secondMove = await book(first.id, 11 * 60, episodeId);
      expect(await failure(tx, (sp) => changeAppointment(sp, whatsappMove(secondMove.id)))).toBe(
        '23514',
      );
    });
  });
});
