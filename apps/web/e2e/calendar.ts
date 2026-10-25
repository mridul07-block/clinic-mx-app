import {
  appointment,
  appointmentType,
  bookAppointment,
  centre,
  changeAppointment,
  consultation,
  createDb,
  job,
  priceItem,
  roster,
  slotHold,
  staffUser,
  systemActor,
  task,
  withActor,
} from '@clinic-mx/db';
import { istDate, istInstant, type Block } from '@clinic-mx/schemas';
import { eq, inArray, sql } from 'drizzle-orm';

// The calendar for end to end tests (SCH-05). Each test uses its own temporary physio, so tests
// running side by side never share a column; afterwards their appointments, holds and hours are
// removed (the audit keeps them). Generated patients only (rule 12).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

async function idOf<T extends { id: unknown }>(rows: Promise<T[]>, what: string) {
  const [row] = await rows;
  if (!row) throw new Error(`${what} is missing`);
  return row.id as string;
}

export const centreIdByCode = (code: string) =>
  idOf(db().select({ id: centre.id }).from(centre).where(eq(centre.code, code)), code);

/**
 * Gives a physio hours every day at HSR Layout, 09:00 to 13:00 unless `hours` says otherwise, from
 * today; as a consultant, with a consultation fee (a price item key) when given.
 */
export async function physioAtHsr(
  physioId: string,
  options: { consultant?: boolean; feeKey?: string; hours?: Block[] } = {},
): Promise<void> {
  const hsr = await centreIdByCode('HSR');
  const admin = await idOf(
    db()
      .select({ id: staffUser.id })
      .from(staffUser)
      .where(eq(staffUser.email, 'super.admin@clinicmx.test')),
    'the seed Super Admin',
  );
  const fee = options.feeKey
    ? await idOf(
        db().select({ id: priceItem.id }).from(priceItem).where(eq(priceItem.key, options.feeKey)),
        options.feeKey,
      )
    : null;
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx
      .update(staffUser)
      .set({ consultant: options.consultant ?? false, consultationPriceItemId: fee })
      .where(eq(staffUser.id, physioId));
    await tx.insert(roster).values({
      staffUserId: physioId,
      centreId: hsr,
      effectiveFrom: istDate(new Date()),
      weekly: Array.from({ length: 7 }, () => options.hours ?? [{ starts: 9 * 60, ends: 13 * 60 }]),
      createdBy: admin,
    });
  });
}

/** Books a Session for a patient with a physio at HSR Layout, on WhatsApp; its number. */
export async function testAppointment(
  physioId: string,
  patientId: string,
  date: string,
  minutes: number,
): Promise<string> {
  const hsr = await centreIdByCode('HSR');
  const session = await idOf(
    db()
      .select({ id: appointmentType.id })
      .from(appointmentType)
      .where(eq(appointmentType.key, 'session')),
    'Session',
  );
  const booked = await withActor(db(), systemActor('tests'), (tx) =>
    bookAppointment(tx, {
      centreId: hsr,
      physioId,
      appointmentTypeId: session,
      startsAt: istInstant(date, minutes),
      holder: `test:${crypto.randomUUID()}`,
      patientId,
      channel: 'whatsapp',
      step: 15,
      now: new Date(),
    }),
  );
  return booked.number;
}

/**
 * A Session at HSR Layout that started `minutesAgo` before now (negative: still to come) and was
 * booked at the front desk by the seed Super Admin (INT-11), written directly since the engine
 * books only ahead, `minutes` long and as given in `values` (a status and its times, INT-01); its
 * id, number and start.
 */
export async function startedAppointment(
  physioId: string,
  patientId: string,
  minutesAgo: number,
  options: { minutes?: number; values?: Partial<typeof appointment.$inferInsert> } = {},
): Promise<{ id: string; number: string; startsAt: Date }> {
  const hsr = await centreIdByCode('HSR');
  const session = await idOf(
    db()
      .select({ id: appointmentType.id })
      .from(appointmentType)
      .where(eq(appointmentType.key, 'session')),
    'Session',
  );
  const admin = await idOf(
    db()
      .select({ id: staffUser.id })
      .from(staffUser)
      .where(eq(staffUser.email, 'super.admin@clinicmx.test')),
    'the seed Super Admin',
  );
  const startsAt = new Date(Date.now() - minutesAgo * 60_000);
  const [row] = await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .insert(appointment)
      .values({
        number: '',
        patientId,
        centreId: hsr,
        physioId,
        appointmentTypeId: session,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (options.minutes ?? 45) * 60_000),
        channel: 'front_desk',
        bookedBy: admin,
        ...options.values,
      })
      .returning({ id: appointment.id, number: appointment.number }),
  );
  if (!row) throw new Error('The appointment was not recorded.');
  return { id: row.id, number: row.number, startsAt };
}

/** A patient's appointments: channel, who booked, status and who checked in (INT-12). */
export function appointmentsOf(patientId: string) {
  return db()
    .select({
      channel: appointment.channel,
      bookedBy: appointment.bookedBy,
      status: appointment.status,
      checkedInBy: appointment.checkedInBy,
    })
    .from(appointment)
    .where(eq(appointment.patientId, patientId));
}

/** Removes the appointments, holds and hours of the given physios. */
export async function removeCalendarRows(physioIds: string[]): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    // What their no shows raised (ALT-04): the tasks and the queued messages.
    const theirs = sql`(select id::text from appointment where physio_id in ${physioIds})`;
    await tx.delete(task).where(sql`${task.details} ->> 'appointmentId' in ${theirs}`);
    await tx.delete(job).where(sql`${job.payload} ->> 'appointmentId' in ${theirs}`);
    const consultations = sql`(select id from consultation where physio_id in ${physioIds})`;
    // The patient's choices on their plans (BIL-02), with what "I'll think about it" raised.
    const plans = sql`(select id from plan_of_care where consultation_id in ${consultations})`;
    const choices = sql`(select id::text from plan_choice where plan_of_care_id in ${plans})`;
    // Their visits' consultation fee bills and their plans' package bills (BIL-05).
    const bills = sql`(select id from bill where appointment_id in
      (select id from appointment where physio_id in ${physioIds})
      or plan_choice_id in (select id from plan_choice where plan_of_care_id in ${plans}))`;
    // Packages their bills bought (BIL-08), and their expiry reminders.
    const packages = sql`(select id::text from package where bill_id in ${bills})`;
    await tx.delete(job).where(sql`${job.payload} ->> 'packageId' in ${packages}`);
    await tx.execute(sql`delete from package where bill_id in ${bills}`);
    await tx.execute(sql`delete from payment where bill_id in ${bills}`);
    await tx.execute(sql`delete from bill_line where bill_id in ${bills}`);
    await tx.execute(sql`delete from bill where id in ${bills}`);
    await tx.delete(task).where(sql`${task.details} ->> 'choiceId' in ${choices}`);
    await tx.delete(job).where(sql`${job.payload} ->> 'choiceId' in ${choices}`);
    await tx.execute(sql`delete from plan_choice where plan_of_care_id in ${plans}`);
    // What signing their consultations wrote (CLN-09), then the consultations (CLN-02).
    await tx.execute(
      sql`delete from plan_modality where plan_of_care_id in
        (select id from plan_of_care where consultation_id in ${consultations})`,
    );
    for (const table of [
      'plan_of_care',
      'diagnosis',
      'special_test_result',
      'measure',
      'addendum',
    ]) {
      await tx.execute(
        sql`delete from ${sql.identifier(table)} where consultation_id in ${consultations}`,
      );
    }
    await tx.delete(consultation).where(inArray(consultation.physioId, physioIds));
    await tx.delete(appointment).where(inArray(appointment.physioId, physioIds));
    await tx.delete(slotHold).where(inArray(slotHold.physioId, physioIds));
    await tx.delete(roster).where(inArray(roster.staffUserId, physioIds));
  });
}

/** How many holds the given physios have, live or not (SCH-07: Cancel gives the hold back). */
export async function holdCount(physioIds: string[]): Promise<number> {
  const rows = await db()
    .select({ id: slotHold.id })
    .from(slotHold)
    .where(inArray(slotHold.physioId, physioIds));
  return rows.length;
}

/** Lets the given physios' holds run out now, as if the minutes had passed. */
export async function expireHolds(physioIds: string[]): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(slotHold)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(inArray(slotHold.physioId, physioIds)),
  );
}

/**
 * A WhatsApp booking at `from` minutes moved to `to` on the same day, as the reschedule does it
 * (SCH-08), with who asked; the seed Super Admin is recorded as who moved it.
 */
export async function testMove(
  physioId: string,
  patientId: string,
  date: string,
  from: number,
  to: number,
  reason: 'patient' | 'clinic',
): Promise<void> {
  const hsr = await centreIdByCode('HSR');
  const [session] = await db()
    .select({ id: appointmentType.id })
    .from(appointmentType)
    .where(eq(appointmentType.key, 'session'));
  const [admin] = await db()
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(eq(staffUser.email, 'super.admin@clinicmx.test'));
  if (!session || !admin) throw new Error('The seed is missing Session or the Super Admin.');
  const request = (minutes: number) => ({
    centreId: hsr,
    physioId,
    appointmentTypeId: session.id,
    startsAt: istInstant(date, minutes),
    holder: `test:${crypto.randomUUID()}`,
    patientId,
    channel: 'whatsapp' as const,
    step: 15,
    now: new Date(),
  });
  await withActor(db(), systemActor('tests'), async (tx) => {
    const first = await bookAppointment(tx, request(from));
    await changeAppointment(tx, {
      appointmentId: first.id,
      status: 'rescheduled',
      reason,
      changedBy: admin.id,
      now: new Date(),
    });
    await bookAppointment(tx, { ...request(to), rescheduledFromId: first.id });
  });
}
