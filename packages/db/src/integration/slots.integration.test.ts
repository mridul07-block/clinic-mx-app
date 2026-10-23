import { addDays, istDate } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { insertLeave } from '../rosters';
import { liftBookingBlock } from '../booking-counters';
import { appointment, auditEvent, bookingCounter, centre, slotHold } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import {
  SlotRefusedError,
  appointmentRecord,
  bookAppointment,
  changeAppointment,
  checkIn,
  currentHold,
  datesWithFreeSlots,
  freeSlots,
  markNoShow,
  placeHold,
  undoCheckIn,
  undoNoShow,
} from '../slots';
import { todayBoard } from '../today';
import { checkInView, healthFormLink, insertPatientReport, patientReports } from '../check-in';
import { insertPatientLink } from '../patient-links';
import { becomeStaff, on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// SCH-04: the slot engine in the database. Free starts leave out the physio's appointments at
// every centre, approved leave and other holders' live holds; consultant types and the centre's
// treadmills are respected; the exclusion constraints refuse overlaps whatever the code does;
// numbers come from the centre's prefix; busy times are for staff only. Every test runs in a
// transaction that is rolled back (the concurrent tests, which must commit, are in
// slots-concurrency.integration.test.ts). CI database only.
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
const deskHsr = member('desk.hsr@clinicmx.test');
const deskWhitefield = member('desk.whitefield@clinicmx.test');
const finance = member('finance@clinicmx.test');
const manager = member('manager@clinicmx.test');
const physioHsr = member('physio.hsr@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

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

/** The refusal a call ended with, inside a savepoint. */
async function refusal(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    if (error instanceof SlotRefusedError) return error.refusal;
    throw error;
  }
  return undefined;
}

const now = () => new Date();

/**
 * An appointment that has already started (INT-11), written directly since the engine books only
 * ahead: a minute long, `minutesAgo` before now (a few, to stay on today's IST date), or
 * `daysAgo` days before that.
 */
async function pastAppointment(
  tx: Tx,
  at: { physioId: string; patientId: string; typeId: string; minutesAgo: number; daysAgo?: number },
) {
  const startsAt = new Date(
    now().getTime() - (at.minutesAgo + (at.daysAgo ?? 0) * 24 * 60) * 60000,
  );
  const [row] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId: at.patientId,
      centreId: centreIds.hsrLayout,
      physioId: at.physioId,
      appointmentTypeId: at.typeId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60000),
      channel: 'front_desk',
      bookedBy: superAdmin.id,
    })
    .returning({ id: appointment.id });
  if (!row) throw new Error('The appointment was not recorded.');
  return row;
}
const minutesOf = (instants: Date[]) =>
  instants.map((instant) => (instant.getTime() - on(0).getTime()) / 60000);

describe('the slot engine', () => {
  it('leaves out appointments at any centre, leave and other holds, seen by a front desk', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout, centreIds.koramangala],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      // At Koramangala, 10:00 to 10:45, which the HSR front desk cannot read.
      await bookAppointment(tx, {
        centreId: centreIds.koramangala,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt: on(600),
        holder: 'test:other',
        patientId,
        channel: 'whatsapp',
        step: 15,
        now: now(),
      });
      await insertLeave(tx, {
        staffUserId: physio.id,
        startsAt: on(720),
        endsAt: on(780),
        allDay: false,
        note: null,
        status: 'approved',
        requestedBy: superAdmin.id,
      });
      await placeHold(tx, {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt: on(540),
        holder: 'flow:held',
        holdMinutes: 5,
        step: 15,
        now: now(),
      });
      // An expired hold gives its time back.
      await tx.insert(slotHold).values({
        holder: 'flow:lapsed',
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt: on(660),
        endsAt: on(705),
        expiresAt: new Date(Date.now() - 1000),
      });

      await becomeStaff(tx, deskHsr);
      const request = {
        centreId: centreIds.hsrLayout,
        appointmentTypeId: session,
        date: testDate,
        physioId: physio.id,
        step: 15,
        now: now(),
      };
      const [listed] = await freeSlots(tx, request);
      expect(listed?.physioName).toBe(physio.name);
      // 09:00 to 13:00, less the hold (09:00 to 09:45), the appointment (10:00 to 10:45) and
      // leave from 12:00: 45 minute starts at 10:45, 11:00 and 11:15.
      expect(minutesOf(listed?.slots.map((s) => s.startsAt) ?? [])).toEqual([645, 660, 675]);
      const [asHolder] = await freeSlots(tx, { ...request, holder: 'flow:held' });
      expect(minutesOf(asHolder?.slots.map((s) => s.startsAt) ?? [])).toEqual([
        540, 555, 645, 660, 675,
      ]);
      expect(
        await tx.select().from(appointment).where(eq(appointment.physioId, physio.id)),
      ).toEqual([]);
      const dates = await datesWithFreeSlots(tx, {
        centreId: centreIds.hsrLayout,
        appointmentTypeId: session,
        from: addDays(testDate, -1),
        days: 3,
        step: 15,
        now: now(),
      });
      expect(dates).toEqual([addDays(testDate, -1), testDate, addDays(testDate, 1)]);
    });
  });

  it('books Consultation and Review only with a consultant', async () => {
    await rolledBack(async (tx) => {
      const consultation = await typeId(tx, 'consultation');
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.whitefield],
        createdBy: superAdmin.id,
      });
      const consultant = await testPhysio(tx, {
        centreIds: [centreIds.whitefield],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const listed = await freeSlots(tx, {
        centreId: centreIds.whitefield,
        appointmentTypeId: consultation,
        date: testDate,
        step: 15,
        now: now(),
      });
      const ids = listed.map((p) => p.physioId);
      expect(ids).toContain(consultant.id);
      expect(ids).not.toContain(physio.id);
      const patientId = await testPatient(tx);
      const booking = {
        centreId: centreIds.whitefield,
        physioId: physio.id,
        startsAt: on(540),
        holder: 'test:desk',
        patientId,
        channel: 'whatsapp' as const,
        step: 15,
        now: now(),
      };
      expect(
        await refusal(tx, (sp) =>
          bookAppointment(sp, { ...booking, appointmentTypeId: consultation }),
        ),
      ).toBe('needs_consultant');
      expect(
        await refusal(tx, (sp) => bookAppointment(sp, { ...booking, appointmentTypeId: session })),
      ).toBeUndefined();
    });
  });

  it('shares the centre’s treadmills between physios', async () => {
    await rolledBack(async (tx) => {
      const treadmill = await typeId(tx, 'zero_gravity_treadmill');
      const first = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const second = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      await tx.update(centre).set({ treadmills: 1 }).where(eq(centre.id, centreIds.hsrLayout));
      const booking = {
        centreId: centreIds.hsrLayout,
        appointmentTypeId: treadmill,
        startsAt: on(600),
        holder: 'test:desk',
        patientId: await testPatient(tx),
        channel: 'whatsapp' as const,
        step: 15,
        now: now(),
      };
      const booked = await bookAppointment(tx, { ...booking, physioId: first.id });
      expect((await appointmentRecord(tx, booked.id))?.machineUnit).toBe(1);
      const [secondFree] = await freeSlots(tx, {
        centreId: centreIds.hsrLayout,
        appointmentTypeId: treadmill,
        date: testDate,
        physioId: second.id,
        step: 15,
        now: now(),
      });
      // The 30 minute treadmill is busy from 10:00 to 10:30.
      const starts = minutesOf(secondFree?.slots.map((s) => s.startsAt) ?? []);
      expect(starts).toContain(570);
      expect(starts).not.toContain(585);
      expect(starts).not.toContain(600);
      expect(starts).toContain(630);
      expect(
        await refusal(tx, (sp) => bookAppointment(sp, { ...booking, physioId: second.id })),
      ).toBe('no_machine');
      await tx.update(centre).set({ treadmills: 2 }).where(eq(centre.id, centreIds.hsrLayout));
      const other = await bookAppointment(tx, { ...booking, physioId: second.id });
      expect((await appointmentRecord(tx, other.id))?.machineUnit).toBe(2);
    });
  });

  it('refuses overlaps in the database, and frees the time when cancelled or rescheduled', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const treadmill = await typeId(tx, 'zero_gravity_treadmill');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const other = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      const row = (from: number, to: number, extra = {}) => ({
        number: '',
        patientId,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt: on(from),
        endsAt: on(to),
        channel: 'whatsapp' as const,
        ...extra,
      });
      const [first] = await tx
        .insert(appointment)
        .values(row(600, 645))
        .returning({ id: appointment.id });
      expect(await failure(tx, (sp) => sp.insert(appointment).values(row(630, 675)))).toBe('23P01');
      // Touching ends are fine (no buffer).
      expect(await failure(tx, (sp) => sp.insert(appointment).values(row(645, 690)))).toBe(
        undefined,
      );
      for (const [status, from] of [
        ['cancelled', 840],
        ['rescheduled', 900],
      ] as const) {
        const [freed] = await tx
          .insert(appointment)
          .values(row(from, from + 45))
          .returning({ id: appointment.id });
        await tx
          .update(appointment)
          .set({ status, changeReason: 'clinic', changedAt: new Date(), changedBy: superAdmin.id })
          .where(eq(appointment.id, freed?.id ?? ''));
        expect(await failure(tx, (sp) => sp.insert(appointment).values(row(from, from + 45)))).toBe(
          undefined,
        );
      }
      expect(first?.id).toBeDefined();
      const machine = (physioId: string) =>
        row(780, 810, {
          physioId,
          appointmentTypeId: treadmill,
          machine: 'zero_gravity_treadmill',
          machineUnit: 1,
        });
      await tx.insert(appointment).values(machine(physio.id));
      expect(await failure(tx, (sp) => sp.insert(appointment).values(machine(other.id)))).toBe(
        '23P01',
      );
      const hold = (holder: string) => ({
        holder,
        centreId: centreIds.hsrLayout,
        physioId: other.id,
        appointmentTypeId: session,
        startsAt: on(540),
        endsAt: on(585),
        expiresAt: new Date(Date.now() + 60000),
      });
      await tx.insert(slotHold).values(hold('test:a'));
      expect(await failure(tx, (sp) => sp.insert(slotHold).values(hold('test:b')))).toBe('23P01');
    });
  });

  it('numbers appointments from the centre’s prefix and keeps what was booked', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout, centreIds.koramangala],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      const book = (centreId: string, minutes: number) =>
        bookAppointment(tx, {
          centreId,
          physioId: physio.id,
          appointmentTypeId: session,
          startsAt: on(minutes),
          holder: 'test:desk',
          patientId,
          channel: 'whatsapp',
          step: 15,
          now: now(),
        });
      const first = await book(centreIds.hsrLayout, 540);
      const second = await book(centreIds.hsrLayout, 600);
      const third = await book(centreIds.koramangala, 660);
      expect(first.number).toMatch(/^MVH-\d{5}$/);
      expect(Number(second.number.slice(4))).toBe(Number(first.number.slice(4)) + 1);
      expect(third.number).toMatch(/^MVK-\d{5}$/);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({ startsAt: on(550) })
            .where(eq(appointment.id, first.id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(centre)
            .set({ appointmentPrefix: 'MVX' })
            .where(eq(centre.id, centreIds.hsrLayout)),
        ),
      ).toBe('23514');
      const audited = await tx
        .select({ action: auditEvent.action, actor: auditEvent.actor })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'appointment'), eq(auditEvent.entityId, first.id)));
      expect(audited).toEqual([{ action: 'insert', actor: 'system:tests' }]);
    });
  });

  it('keeps one hold per holder, rechecks at booking and releases expired holds', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const base = {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        holdMinutes: 5,
        step: 15,
        now: now(),
      };
      await placeHold(tx, { ...base, holder: 'flow:one', startsAt: on(540) });
      const { expiresAt } = await placeHold(tx, {
        ...base,
        holder: 'flow:one',
        startsAt: on(600),
      });
      expect(expiresAt.getTime() - base.now.getTime()).toBe(5 * 60000);
      const held = await tx.select().from(slotHold).where(eq(slotHold.holder, 'flow:one'));
      expect(held.map((h) => h.startsAt)).toEqual([on(600)]);

      const patientId = await testPatient(tx);
      const booking = { ...base, patientId, channel: 'whatsapp' as const, startsAt: on(600) };
      expect(
        await refusal(tx, (sp) => bookAppointment(sp, { ...booking, holder: 'flow:two' })),
      ).toBe('taken');
      // Lapsed: the time is free again, and booking clears it.
      await tx
        .update(slotHold)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(slotHold.holder, 'flow:one'));
      await bookAppointment(tx, { ...booking, holder: 'flow:two' });
      expect(await tx.select().from(slotHold).where(eq(slotHold.physioId, physio.id))).toEqual([]);
      const jobs = await tx.execute<{ schedule: string }>(
        sql`select schedule from cron.job where jobname = 'slot-hold-release'`,
      );
      expect(jobs.map((j) => j.schedule)).toEqual(['* * * * *']);
    });
  });

  // SCH-08: only Booked or Confirmed is cancelled or rescheduled, with who asked; then it never
  // changes. A move books a new appointment pointing at the old one, in the same transaction, and
  // may overlap the old time with the same physio.
  it('cancels and reschedules under the database guard, freeing the old time for the move', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      const base = {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        patientId,
        channel: 'front_desk' as const,
        bookedBy: superAdmin.id,
        holder: 'test:move',
        step: 15,
        now: now(),
      };
      const first = await bookAppointment(tx, { ...base, startsAt: on(600) });
      const change = (status: 'cancelled' | 'rescheduled', appointmentId: string) =>
        changeAppointment(tx, {
          appointmentId,
          status,
          reason: 'patient',
          changedBy: superAdmin.id,
          now: now(),
        });

      // Without freeing, 10:30 overlaps the 10:00 Session; with it, the move is held and booked.
      const later = { ...base, holdMinutes: 5, startsAt: on(630) };
      expect(await refusal(tx, (sp) => placeHold(sp, later))).toBe('taken');
      await placeHold(tx, { ...later, freeing: first.id });
      // A refused new start leaves the old appointment as it was.
      expect(
        await refusal(tx, async (sp) => {
          await changeAppointment(sp, {
            appointmentId: first.id,
            status: 'rescheduled',
            reason: 'clinic',
            changedBy: superAdmin.id,
            now: now(),
          });
          await bookAppointment(sp, { ...base, holder: 'test:other', startsAt: on(630) });
        }),
      ).toBe('taken');
      const [still] = await tx.select().from(appointment).where(eq(appointment.id, first.id));
      expect(still?.status).toBe('booked');

      expect(await change('rescheduled', first.id)).toEqual({ id: first.id });
      const moved = await bookAppointment(tx, {
        ...base,
        startsAt: on(630),
        rescheduledFromId: first.id,
      });
      const [old] = await tx.select().from(appointment).where(eq(appointment.id, first.id));
      expect(old).toMatchObject({
        status: 'rescheduled',
        changeReason: 'patient',
        changedBy: superAdmin.id,
      });
      // Never changed again, never moved twice, the link fixed.
      expect(await change('cancelled', first.id)).toBeUndefined();
      expect(
        await failure(tx, (sp) =>
          sp.update(appointment).set({ status: 'booked' }).where(eq(appointment.id, first.id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          bookAppointment(sp, { ...base, startsAt: on(720), rescheduledFromId: first.id }),
        ),
      ).toBe('23505');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({ rescheduledFromId: null })
            .where(eq(appointment.id, moved.id)),
        ),
      ).toBe('23514');

      // A completed appointment is not cancelled; a cancel always says who asked.
      await tx.update(appointment).set({ status: 'completed' }).where(eq(appointment.id, moved.id));
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({
              status: 'cancelled',
              changeReason: 'clinic',
              changedAt: now(),
              changedBy: superAdmin.id,
            })
            .where(eq(appointment.id, moved.id)),
        ),
      ).toBe('23514');
      const third = await bookAppointment(tx, { ...base, startsAt: on(690) });
      expect(
        await failure(tx, (sp) =>
          sp.update(appointment).set({ status: 'cancelled' }).where(eq(appointment.id, third.id)),
        ),
      ).toBe('23514');
      expect(await change('cancelled', third.id)).toEqual({ id: third.id });

      const audited = await tx
        .select({ id: auditEvent.id })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'appointment'), eq(auditEvent.entityId, third.id)));
      expect(audited.length).toBeGreaterThanOrEqual(2);
    });
  });

  // SCH-09: the database counts reschedules asked by the patient and no shows, once per change;
  // those who book read the counts, only a manager lifts them, and a blocked patient is still
  // booked at the front desk.
  it('counts reschedules asked by the patient and no shows, read by those who book', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      const book = (minutes: number) =>
        bookAppointment(tx, {
          centreId: centreIds.hsrLayout,
          physioId: physio.id,
          appointmentTypeId: session,
          patientId,
          channel: 'front_desk',
          bookedBy: superAdmin.id,
          holder: 'test:counter',
          startsAt: on(minutes),
          step: 15,
          now: now(),
        });
      const change = (
        appointmentId: string,
        status: 'cancelled' | 'rescheduled',
        reason: 'patient' | 'clinic',
      ) =>
        changeAppointment(tx, {
          appointmentId,
          status,
          reason,
          changedBy: superAdmin.id,
          now: now(),
        });
      const counts = async () =>
        (
          await tx
            .select({ reschedules: bookingCounter.reschedules, noShows: bookingCounter.noShows })
            .from(bookingCounter)
            .where(eq(bookingCounter.patientId, patientId))
        )[0];

      await change((await book(540)).id, 'rescheduled', 'clinic');
      await change((await book(600)).id, 'cancelled', 'patient');
      expect(await counts()).toBeUndefined();
      await change((await book(660)).id, 'rescheduled', 'patient');
      const missed = await pastAppointment(tx, {
        physioId: physio.id,
        patientId,
        typeId: session,
        minutesAgo: 2,
      });
      await markNoShow(tx, { appointmentId: missed.id, by: superAdmin.id, now: now() });
      // Another change to the same row without a new status counts nothing more.
      await tx.update(appointment).set({ updatedAt: now() }).where(eq(appointment.id, missed.id));
      expect(await counts()).toEqual({ reschedules: 1, noShows: 1 });
      await change((await book(540)).id, 'rescheduled', 'patient');
      expect(await counts()).toEqual({ reschedules: 2, noShows: 1 });
      // Blocked for self booking, still booked at the front desk.
      expect((await book(600)).number).toMatch(/^MVH-\d{5}$/);

      const [row] = await tx
        .select({ id: bookingCounter.id })
        .from(bookingCounter)
        .where(eq(bookingCounter.patientId, patientId));
      const audited = await tx
        .select({ id: auditEvent.id })
        .from(auditEvent)
        .where(
          and(eq(auditEvent.entity, 'booking_counter'), eq(auditEvent.entityId, row?.id ?? '')),
        );
      // The first count adds the row, the next two change it.
      expect(audited.length).toBe(3);

      const as = async (actor: StaffMember, work: (sp: Tx) => Promise<void>) => {
        try {
          await tx.transaction(async (sp) => {
            await becomeStaff(sp, actor);
            await work(sp);
            throw new Rollback();
          });
        } catch (error) {
          if (!(error instanceof Rollback)) throw error;
        }
      };
      const lift = (sp: Tx, who: StaffMember) =>
        liftBookingBlock(sp, { patientId, liftedBy: who.id, now: now() });
      await as(deskHsr, async (sp) => {
        expect(
          await sp.select().from(bookingCounter).where(eq(bookingCounter.patientId, patientId)),
        ).toHaveLength(1);
        expect(await lift(sp, deskHsr)).toBe(false);
      });
      await as(physioHsr, async (sp) => {
        expect(
          await sp.select().from(bookingCounter).where(eq(bookingCounter.patientId, patientId)),
        ).toHaveLength(0);
      });
      await as(manager, async (sp) => {
        expect(await lift(sp, manager)).toBe(true);
        const [lifted] = await sp
          .select()
          .from(bookingCounter)
          .where(eq(bookingCounter.patientId, patientId));
        expect(lifted).toMatchObject({ reschedules: 0, noShows: 0, liftedBy: manager.id });
      });
    });
  });

  // INT-11: only a Booked or Confirmed appointment whose start has passed becomes a no show, with
  // who marked it; an undo goes back to Booked or Confirmed on its own day and takes the count back
  // down, never below zero.
  it('marks and undoes no shows, counting them and guarding the changes', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      const at = { physioId: physio.id, patientId, typeId: session };
      const noShows = async () =>
        (
          await tx
            .select({ noShows: bookingCounter.noShows })
            .from(bookingCounter)
            .where(eq(bookingCounter.patientId, patientId))
        )[0]?.noShows;
      const statusOf = async (id: string) => (await appointmentRecord(tx, id))?.status;
      const mark = (sp: Tx, appointmentId: string) =>
        markNoShow(sp, { appointmentId, by: deskHsr.id, now: now() });

      const missed = await pastAppointment(tx, { ...at, minutesAgo: 2 });
      expect(await mark(tx, missed.id)).toEqual({ id: missed.id });
      const [marked] = await tx
        .select({ noShowAt: appointment.noShowAt, noShowBy: appointment.noShowBy })
        .from(appointment)
        .where(eq(appointment.id, missed.id));
      expect(marked?.noShowBy).toBe(deskHsr.id);
      expect(marked?.noShowAt).toBeInstanceOf(Date);
      expect(await noShows()).toBe(1);
      // Marking twice changes nothing.
      expect(await mark(tx, missed.id)).toBeUndefined();
      expect(await noShows()).toBe(1);

      expect(await undoNoShow(tx, { appointmentId: missed.id, now: now() })).toEqual({
        id: missed.id,
      });
      expect(await statusOf(missed.id)).toBe('booked');
      expect(await noShows()).toBe(0);
      const audited = await tx
        .select({ action: auditEvent.action })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'appointment'), eq(auditEvent.entityId, missed.id)));
      // Added, marked, undone.
      expect(audited.length).toBe(3);

      // A confirmed one goes back to Confirmed; a lift in between keeps the count at zero.
      const confirmed = await pastAppointment(tx, { ...at, minutesAgo: 4 });
      await tx
        .update(appointment)
        .set({ status: 'confirmed', confirmedAt: now() })
        .where(eq(appointment.id, confirmed.id));
      await mark(tx, confirmed.id);
      expect(await noShows()).toBe(1);
      await liftBookingBlock(tx, { patientId, liftedBy: manager.id, now: now() });
      await undoNoShow(tx, { appointmentId: confirmed.id, now: now() });
      expect(await statusOf(confirmed.id)).toBe('confirmed');
      expect(await noShows()).toBe(0);

      // Refused: before the start, from Checked in, without who marked it, an undo to anything
      // but Booked or Confirmed, and an undo on another day.
      const later = await bookAppointment(tx, {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        patientId,
        channel: 'front_desk',
        bookedBy: superAdmin.id,
        holder: 'test:no-show',
        startsAt: on(600),
        step: 15,
        now: now(),
      });
      expect(await failure(tx, (sp) => mark(sp, later.id))).toBe('23514');
      const arrived = await pastAppointment(tx, { ...at, minutesAgo: 6 });
      await tx
        .update(appointment)
        .set({ status: 'checked_in', arrivedAt: now(), checkedInBy: deskHsr.id })
        .where(eq(appointment.id, arrived.id));
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({ status: 'no_show', noShowAt: now(), noShowBy: deskHsr.id })
            .where(eq(appointment.id, arrived.id)),
        ),
      ).toBe('23514');
      const bare = await pastAppointment(tx, { ...at, minutesAgo: 8 });
      expect(
        await failure(tx, (sp) =>
          sp.update(appointment).set({ status: 'no_show' }).where(eq(appointment.id, bare.id)),
        ),
      ).toBe('23514');
      await mark(tx, bare.id);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({ status: 'completed', noShowAt: null, noShowBy: null })
            .where(eq(appointment.id, bare.id)),
        ),
      ).toBe('23514');
      const yesterday = await pastAppointment(tx, { ...at, minutesAgo: 2, daysAgo: 1 });
      await mark(tx, yesterday.id);
      expect(
        await failure(tx, (sp) => undoNoShow(sp, { appointmentId: yesterday.id, now: now() })),
      ).toBe('23514');
    });
  });

  // INT-01: a Booked or Confirmed patient is checked in on the appointment's own IST day, with the
  // arrival time; an undo goes back on that day only; the Today board leaves out Cancelled and
  // Rescheduled and is read by the front desk under row level security.
  it('checks patients in and undoes it on the day, guarded, for the Today board', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      const at = { physioId: physio.id, patientId, typeId: session };
      const read = async (id: string) =>
        (
          await tx
            .select({ status: appointment.status, arrivedAt: appointment.arrivedAt })
            .from(appointment)
            .where(eq(appointment.id, id))
        )[0];

      const arriving = await pastAppointment(tx, { ...at, minutesAgo: 2 });
      expect(await checkIn(tx, { appointmentId: arriving.id, by: deskHsr.id, now: now() })).toEqual(
        {
          id: arriving.id,
        },
      );
      expect(await read(arriving.id)).toMatchObject({ status: 'checked_in' });
      expect((await read(arriving.id))?.arrivedAt).toBeInstanceOf(Date);
      // Checking in twice changes nothing.
      expect(
        await checkIn(tx, { appointmentId: arriving.id, by: deskHsr.id, now: now() }),
      ).toBeUndefined();
      expect(await undoCheckIn(tx, { appointmentId: arriving.id, now: now() })).toEqual({
        id: arriving.id,
      });
      expect(await read(arriving.id)).toEqual({ status: 'booked', arrivedAt: null });
      const audited = await tx
        .select({ id: auditEvent.id })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'appointment'), eq(auditEvent.entityId, arriving.id)));
      // Added, checked in, undone.
      expect(audited.length).toBe(3);

      const confirmed = await pastAppointment(tx, { ...at, minutesAgo: 4 });
      await tx
        .update(appointment)
        .set({ status: 'confirmed', confirmedAt: now() })
        .where(eq(appointment.id, confirmed.id));
      await checkIn(tx, { appointmentId: confirmed.id, by: deskHsr.id, now: now() });
      await undoCheckIn(tx, { appointmentId: confirmed.id, now: now() });
      expect((await read(confirmed.id))?.status).toBe('confirmed');

      // Refused: another day, from No show, without an arrival time, and an undo another day.
      const ahead = await bookAppointment(tx, {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        patientId,
        channel: 'front_desk',
        bookedBy: superAdmin.id,
        holder: 'test:check-in',
        startsAt: on(600),
        step: 15,
        now: now(),
      });
      expect(
        await failure(tx, (sp) =>
          checkIn(sp, { appointmentId: ahead.id, by: deskHsr.id, now: now() }),
        ),
      ).toBe('23514');
      const missed = await pastAppointment(tx, { ...at, minutesAgo: 6 });
      await markNoShow(tx, { appointmentId: missed.id, by: deskHsr.id, now: now() });
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({
              status: 'checked_in',
              arrivedAt: now(),
              checkedInBy: deskHsr.id,
              noShowAt: null,
              noShowBy: null,
            })
            .where(eq(appointment.id, missed.id)),
        ),
      ).toBe('23514');
      const bare = await pastAppointment(tx, { ...at, minutesAgo: 8 });
      expect(
        await failure(tx, (sp) =>
          sp.update(appointment).set({ status: 'checked_in' }).where(eq(appointment.id, bare.id)),
        ),
      ).toBe('23514');
      // Left checked in yesterday (written as it was, the guard watches changes only).
      const startedYesterday = new Date(now().getTime() - 24 * 60 * 60000);
      const [yesterday] = await tx
        .insert(appointment)
        .values({
          number: '',
          patientId,
          centreId: centreIds.hsrLayout,
          physioId: physio.id,
          appointmentTypeId: session,
          startsAt: startedYesterday,
          endsAt: new Date(startedYesterday.getTime() + 60000),
          channel: 'front_desk',
          bookedBy: superAdmin.id,
          status: 'checked_in',
          arrivedAt: startedYesterday,
          checkedInBy: deskHsr.id,
        })
        .returning({ id: appointment.id });
      expect(
        await failure(tx, (sp) =>
          undoCheckIn(sp, { appointmentId: yesterday?.id ?? '', now: now() }),
        ),
      ).toBe('23514');

      // The board: today's appointments at the centre, without Cancelled, for the front desk.
      const dropped = await pastAppointment(tx, { ...at, minutesAgo: 10 });
      await changeAppointment(tx, {
        appointmentId: dropped.id,
        status: 'cancelled',
        reason: 'patient',
        changedBy: superAdmin.id,
        now: now(),
      });
      await tx.transaction(async (sp) => {
        await becomeStaff(sp, deskHsr);
        const board = await todayBoard(sp, {
          centreId: centreIds.hsrLayout,
          date: istDate(now()),
        });
        const mine = board.filter((row) => row.physioId === physio.id).map((row) => row.id);
        expect(mine).toEqual(
          expect.arrayContaining([arriving.id, confirmed.id, missed.id, bare.id]),
        );
        expect(mine).not.toContain(dropped.id);
        expect(board.find((row) => row.id === arriving.id)).toMatchObject({
          physioName: physio.name,
          typeName: 'Session',
        });
      });
    });
  });

  // INT-02: check in records who did it; those who check in issue and read the health form link
  // of an appointment they can see, and no other link; they add report rows as themselves.
  it('records who checked in, and lets the desk issue form links and add reports', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      const visit = await pastAppointment(tx, {
        physioId: physio.id,
        patientId,
        typeId: session,
        minutesAgo: 2,
      });
      await checkIn(tx, { appointmentId: visit.id, by: deskHsr.id, now: now() });
      expect(await checkInView(tx, visit.id)).toMatchObject({
        status: 'checked_in',
        checkedInByName: deskHsr.name,
        episodeId: null,
      });
      // Arrived without who checked the patient in: refused.
      const other = await pastAppointment(tx, {
        physioId: physio.id,
        patientId,
        typeId: session,
        minutesAgo: 4,
      });
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({ status: 'checked_in', arrivedAt: now() })
            .where(eq(appointment.id, other.id)),
        ),
      ).toBe('23514');

      const expiresAt = new Date(now().getTime() + 60 * 60000);
      const as = async (actor: StaffMember, work: (sp: Tx) => Promise<void>) => {
        try {
          await tx.transaction(async (sp) => {
            await becomeStaff(sp, actor);
            await work(sp);
            throw new Rollback();
          });
        } catch (error) {
          if (!(error instanceof Rollback)) throw error;
        }
      };
      await as(deskHsr, async (sp) => {
        const link = await insertPatientLink(sp, {
          patientId,
          purpose: 'health_form',
          appointmentId: visit.id,
          expiresAt,
        });
        expect((await healthFormLink(sp, visit.id))?.id).toBe(link.id);
        // Not another kind of link, even for the same appointment.
        expect(
          await failure(sp, (inner) =>
            insertPatientLink(inner, {
              patientId,
              purpose: 'consent',
              appointmentId: visit.id,
              expiresAt,
            }),
          ),
        ).toBe('42501');
        await insertPatientReport(sp, {
          id: crypto.randomUUID(),
          patientId,
          appointmentId: visit.id,
          filePath: `${patientId}/${crypto.randomUUID()}.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 1234,
          uploadedBy: deskHsr.id,
        });
        expect(await patientReports(sp, patientId)).toEqual([
          expect.objectContaining({ uploadedByName: deskHsr.name, sizeBytes: 1234 }),
        ]);
        // Only as themselves.
        expect(
          await failure(sp, (inner) =>
            insertPatientReport(inner, {
              id: crypto.randomUUID(),
              patientId,
              appointmentId: visit.id,
              filePath: `${patientId}/${crypto.randomUUID()}.jpg`,
              contentType: 'image/jpeg',
              sizeBytes: 1,
              uploadedBy: superAdmin.id,
            }),
          ),
        ).toBe('42501');
      });
      // Another centre's front desk cannot see the appointment, so cannot issue its link.
      await as(deskWhitefield, async (sp) => {
        expect(
          await failure(sp, (inner) =>
            insertPatientLink(inner, {
              patientId,
              purpose: 'health_form',
              appointmentId: visit.id,
              expiresAt,
            }),
          ),
        ).toBe('42501');
      });
      // A physio adds no reports.
      await as(physioHsr, async (sp) => {
        expect(
          await failure(sp, (inner) =>
            insertPatientReport(inner, {
              id: crypto.randomUUID(),
              patientId,
              appointmentId: visit.id,
              filePath: `${patientId}/${crypto.randomUUID()}.jpg`,
              contentType: 'image/jpeg',
              sizeBytes: 1,
              uploadedBy: physioHsr.id,
            }),
          ),
        ).toBe('42501');
      });
    });
  });

  // SCH-07: the booking sheet shows the person's own hold while it lasts.
  it('reads one’s own live hold only', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout, centreIds.whitefield],
        createdBy: superAdmin.id,
      });
      const base = {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        holdMinutes: 5,
        step: 15,
        now: now(),
      };
      const mine = `staff:${deskHsr.id}`;
      await placeHold(tx, { ...base, holder: mine, startsAt: on(540) });
      await placeHold(tx, { ...base, holder: `staff:${deskWhitefield.id}`, startsAt: on(600) });
      expect(await currentHold(tx, mine, base.now)).toMatchObject({
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt: on(540),
      });
      // Once it has run out it is not shown, though the release job has not run yet.
      expect(await currentHold(tx, mine, new Date(base.now.getTime() + 5 * 60000))).toBeUndefined();

      await becomeStaff(tx, deskHsr);
      expect((await currentHold(tx, mine, base.now))?.startsAt).toEqual(on(540));
      expect(await currentHold(tx, `staff:${deskWhitefield.id}`, base.now)).toBeUndefined();
    });
  });

  it('refuses a past, off grid or out of hours start, and an inactive type', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const booking = {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        holder: 'test:desk',
        patientId: await testPatient(tx),
        channel: 'whatsapp' as const,
        step: 15,
        now: now(),
      };
      const at = (startsAt: Date, extra = {}) =>
        refusal(tx, (sp) => bookAppointment(sp, { ...booking, startsAt, ...extra }));
      expect(await at(on(540), { now: on(600) })).toBe('past');
      expect(await at(on(545))).toBe('off_grid');
      expect(await at(on(750))).toBe('outside_hours');
      expect(await at(on(540), { centreId: centreIds.whitefield })).toBe('not_offered');
      await tx.execute(sql`update appointment_type set active = false where id = ${session}`);
      expect(await at(on(540))).toBe('type_inactive');
    });
  });
});

describe('access', () => {
  it('gives busy times to staff and the server only', async () => {
    await rolledBack(async (tx) => {
      const busy = sql`select * from internal.busy_times('{}'::uuid[], now(), now(), null)`;
      expect(
        await failure(tx, async (sp) => {
          await sp.execute(
            sql`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`,
          );
          await sp.execute(sql`set local role authenticated`);
          await sp.execute(busy);
        }),
      ).toBe('42501');
      expect(
        await failure(tx, async (sp) => {
          await sp.execute(sql`set local role anon`);
          await sp.execute(busy);
        }),
      ).toBe('42501');
      expect(await failure(tx, (sp) => sp.execute(busy))).toBeUndefined();
    });
  });

  it('lets each role read and write only its own appointments, and nobody delete', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const patientId = await testPatient(tx);
      const booked = await bookAppointment(tx, {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt: on(540),
        holder: 'test:desk',
        patientId,
        channel: 'whatsapp',
        step: 15,
        now: now(),
      });
      const seen = async (actor: StaffMember) => {
        let ids: string[] = [];
        await tx.transaction(async (sp) => {
          await becomeStaff(sp, actor);
          ids = (await sp.select({ id: appointment.id }).from(appointment)).map((r) => r.id);
          await sp.execute(sql`reset role`);
          await sp.execute(sql`select set_config('request.jwt.claims', '', true)`);
        });
        return ids.includes(booked.id);
      };
      expect(await seen(deskHsr)).toBe(true);
      expect(await seen(physio)).toBe(true);
      expect(await seen(deskWhitefield)).toBe(false);
      expect(await seen(finance)).toBe(false);

      const write = (actor: StaffMember) =>
        failure(tx, async (sp) => {
          await becomeStaff(sp, actor);
          await sp.insert(appointment).values({
            number: '',
            patientId,
            centreId: centreIds.hsrLayout,
            physioId: physio.id,
            appointmentTypeId: session,
            startsAt: on(660),
            endsAt: on(705),
            channel: 'front_desk',
            bookedBy: actor.id,
          });
        });
      expect(await write(deskWhitefield)).toBe('42501');
      expect(await write(physio)).toBe('42501');
      expect(await write(support)).toBe('42501');
      expect(await write(deskHsr)).toBeUndefined();

      await becomeStaff(tx, deskHsr);
      const deleted = await tx
        .delete(appointment)
        .where(eq(appointment.id, booked.id))
        .returning({ id: appointment.id });
      expect(deleted).toEqual([]);
    });
  });
});
