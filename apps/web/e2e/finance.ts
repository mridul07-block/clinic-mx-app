import {
  bill,
  centre,
  createDb,
  payment,
  refundCredit,
  staffUser,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { istDate, startOfIstDay } from '@clinic-mx/schemas';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { startedAppointment } from './calendar';

// Money for Finance's end to end tests (DSH-04): a consultation fee paid today at HSR Layout, the
// day's collections counted from the payments, and the rows a test made removed after.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** A booked visit's consultation fee paid by UPI today: the bill's number. */
export async function paidToday(
  physioId: string,
  patientId: string,
  paise: number,
): Promise<string> {
  const visit = await startedAppointment(physioId, patientId, 30);
  return withActor(db(), systemActor('tests'), async (tx) => {
    const [hsr] = await tx.select({ id: centre.id }).from(centre).where(eq(centre.code, 'HSR'));
    const [desk] = await tx
      .select({ id: staffUser.id })
      .from(staffUser)
      .where(eq(staffUser.email, 'desk.hsr@clinicmx.test'));
    await tx.delete(bill).where(eq(bill.appointmentId, visit.id));
    const [made] = await tx
      .insert(bill)
      .values({
        number: `TEST-B-${crypto.randomUUID().slice(0, 8)}`,
        kind: 'consultation',
        status: 'paid',
        patientId,
        centreId: hsr?.id ?? '',
        appointmentId: visit.id,
        totalPaise: paise,
      })
      .returning({ id: bill.id, number: bill.number });
    await tx.insert(payment).values({
      billId: made?.id ?? '',
      method: 'upi',
      amountPaise: paise,
      recordedBy: desk?.id ?? '',
    });
    return made?.number ?? '';
  });
}

/** Payments not undone today at a centre, in paise. */
export async function collectedToday(centreCode: string): Promise<number> {
  const today = istDate(new Date());
  const [row] = await db()
    .select({
      paise: sql<number>`coalesce(sum(${payment.amountPaise}), 0)::bigint`.mapWith(Number),
    })
    .from(payment)
    .innerJoin(bill, eq(bill.id, payment.billId))
    .innerJoin(centre, eq(centre.id, bill.centreId))
    .where(
      and(
        eq(centre.code, centreCode),
        isNull(payment.undoneAt),
        gte(payment.recordedAt, startOfIstDay(today)),
        lt(payment.recordedAt, new Date(startOfIstDay(today).getTime() + 24 * 3600_000)),
      ),
    );
  return row?.paise ?? 0;
}

/** Removes the bills (and their payments) a test made, by number. */
export async function removeBills(numbers: string[]): Promise<void> {
  if (numbers.length === 0) return;
  await withActor(db(), systemActor('tests'), async (tx) => {
    const made = tx.select({ id: bill.id }).from(bill).where(inArray(bill.number, numbers));
    await tx.delete(refundCredit).where(inArray(refundCredit.billId, made));
    await tx.delete(payment).where(inArray(payment.billId, made));
    await tx.delete(bill).where(inArray(bill.number, numbers));
  });
}
