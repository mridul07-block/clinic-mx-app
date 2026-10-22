import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { calendarDay, calendarVersion } from '../calendar';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { insertLeave } from '../rosters';
import { appointment, auditEvent, priceItem, slotHold } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { bookAppointment } from '../slots';
import { consultationFeeOptions, setConsultationFee } from '../staff';
import { becomeStaff, on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// SCH-05: the calendar day in the database. A column per physio with hours at the centre that
// day, their fee when set, free cells without their appointments (at any centre), leave and other
// holders' holds, and their appointments here with the patient; a physio sees only their own
// column; the version changes with the day. Every test runs in a transaction that is rolled back.
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
const deskHsr = member('desk.hsr@clinicmx.test');

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

const minutesOf = (instants: Date[]) =>
  instants.map((instant) => (instant.getTime() - on(0).getTime()) / 60000);
const request = { centreId: centreIds.hsrLayout, date: testDate, step: 15, now: new Date() };

describe('the calendar day', () => {
  it('shows each physio with hours, their fee, free cells and appointments', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const consultant = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout, centreIds.koramangala],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const elsewhere = await testPhysio(tx, {
        centreIds: [centreIds.whitefield],
        createdBy: superAdmin.id,
      });
      const [fee] = await consultationFeeOptions(tx, ['consultation']);
      await setConsultationFee(tx, consultant.id, fee?.id ?? null);
      const patientId = await testPatient(tx);
      const booking = {
        physioId: consultant.id,
        appointmentTypeId: session,
        patientId,
        channel: 'whatsapp' as const,
        step: 15,
        now: new Date(),
      };
      const here = await bookAppointment(tx, {
        ...booking,
        centreId: centreIds.hsrLayout,
        startsAt: on(540),
        holder: 'test:one',
      });
      // At Koramangala: busy here too, but not drawn in this centre's column.
      await bookAppointment(tx, {
        ...booking,
        centreId: centreIds.koramangala,
        startsAt: on(660),
        holder: 'test:two',
      });
      await insertLeave(tx, {
        staffUserId: consultant.id,
        startsAt: on(750),
        endsAt: on(780),
        allDay: false,
        note: null,
        status: 'approved',
        requestedBy: superAdmin.id,
      });
      await tx.insert(slotHold).values({
        holder: 'flow:someone',
        centreId: centreIds.hsrLayout,
        physioId: consultant.id,
        appointmentTypeId: session,
        startsAt: on(600),
        endsAt: on(645),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await becomeStaff(tx, deskHsr);
      const day = await calendarDay(tx, request);
      const column = day.columns.find((c) => c.physioId === consultant.id);
      expect(day.columns.map((c) => c.physioId)).not.toContain(elsewhere.id);
      expect(column).toMatchObject({
        physioName: consultant.name,
        consultant: true,
        fee: { label: 'Consultation', amountPaise: 75000 },
      });
      // 09:00 to 13:00, less 09:00 to 09:45 (booked here), 10:00 to 10:45 (held), 11:00 to
      // 11:45 (Koramangala) and leave from 12:30.
      expect(minutesOf(column?.freeCells ?? [])).toEqual([585, 645, 705, 720, 735]);
      expect(column?.held.map((h) => minutesOf([h.startsAt])[0])).toEqual([600]);
      expect(column?.appointments).toHaveLength(1);
      expect(column?.appointments[0]).toMatchObject({
        id: here.id,
        number: here.number,
        typeName: 'Session',
        status: 'booked',
        channel: 'whatsapp',
      });
      expect(column?.appointments[0]?.patientName).toMatch(/^Test Patient /);
      expect(day.span && minutesOf([day.span.startsAt, day.span.endsAt])).toEqual([540, 780]);
    });
  });

  it('gives a physio their own column only, without others’ appointments', async () => {
    await rolledBack(async (tx) => {
      const one = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const other = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      await becomeStaff(tx, one);
      const day = await calendarDay(tx, { ...request, physioId: one.id });
      expect(day.columns.map((c) => c.physioId)).toEqual([one.id]);
      expect(day.columns.map((c) => c.physioId)).not.toContain(other.id);
    });
  });

  it('changes its version when the day changes', async () => {
    await rolledBack(async (tx) => {
      const session = await typeId(tx, 'session');
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const now = new Date();
      const before = calendarVersion(await calendarDay(tx, { ...request, now }));
      expect(calendarVersion(await calendarDay(tx, { ...request, now }))).toBe(before);
      const booked = await bookAppointment(tx, {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt: on(600),
        holder: 'test:desk',
        patientId: await testPatient(tx),
        channel: 'whatsapp',
        step: 15,
        now,
      });
      const added = calendarVersion(await calendarDay(tx, { ...request, now }));
      expect(added).not.toBe(before);
      await tx
        .update(appointment)
        .set({ status: 'confirmed' })
        .where(eq(appointment.id, booked.id));
      expect(calendarVersion(await calendarDay(tx, { ...request, now }))).not.toBe(added);
    });
  });

  it('audits a consultant’s fee and offers only the listed price items', async () => {
    await rolledBack(async (tx) => {
      const consultant = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const options = await consultationFeeOptions(tx, ['consultation', 'senior_consultation']);
      expect(options.map((o) => o.key)).toEqual(['consultation', 'senior_consultation']);
      const senior = options[1];
      await setConsultationFee(tx, consultant.id, senior?.id ?? null);
      const events = await tx
        .select({ after: auditEvent.after })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.entity, 'staff_user'),
            eq(auditEvent.entityId, consultant.id),
            eq(auditEvent.action, 'update'),
          ),
        );
      expect(events.at(-1)?.after).toMatchObject({ consultation_price_item_id: senior?.id });
      const [item] = await tx
        .select({ amountPaise: priceItem.amountPaise })
        .from(priceItem)
        .where(eq(priceItem.key, 'senior_consultation'));
      expect(item?.amountPaise).toBe(100000);
      const [settings] = await tx.execute<{ value: unknown }>(
        sql`select value from setting where key = 'live.refresh_seconds'`,
      );
      expect(settings?.value).toBe(3);
    });
  });
});
