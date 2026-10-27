import { addDays, startOfIstDay, type BillKind, type PaymentMethod } from '@clinic-mx/schemas';
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { bill, centre, patient, patientPackage, payment } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Finance's dashboards (DSH-04, docs/runbooks/finance-dashboards.md): money figures read under the
 * reader's own row level security, which lets the Super Admin and Finance read every bill, payment
 * and package (and the Front Desk only its centres', who has no dashboard). Run under
 * `withStaffAccess`; the service checks `dashboard.finance` first.
 */

const recordedDay = sql<string>`((${payment.recordedAt} at time zone 'Asia/Kolkata')::date)::text`;
const undoneDay = sql<string>`((${payment.undoneAt} at time zone 'Asia/Kolkata')::date)::text`;
const recordedMonth = sql<string>`to_char(${payment.recordedAt} at time zone 'Asia/Kolkata', 'YYYY-MM')`;

/** Payments not undone per centre, IST day and method: how many, and the paise. */
export async function paymentsDaily(
  db: DbOrTransaction,
  from: string,
  to: string,
): Promise<
  { centreId: string; day: string; method: PaymentMethod; payments: number; paise: number }[]
> {
  return db
    .select({
      centreId: bill.centreId,
      day: recordedDay,
      method: payment.method,
      payments: sql<number>`count(*)::int`.mapWith(Number),
      paise: sql<number>`sum(${payment.amountPaise})::bigint`.mapWith(Number),
    })
    .from(payment)
    .innerJoin(bill, eq(bill.id, payment.billId))
    .where(
      and(
        isNull(payment.undoneAt),
        gte(payment.recordedAt, startOfIstDay(from)),
        lt(payment.recordedAt, startOfIstDay(addDays(to, 1))),
      ),
    )
    .groupBy(bill.centreId, recordedDay, payment.method);
}

/** Payments undone on an IST day, per centre: how many, and the paise taken back. */
export async function paymentsUndone(
  db: DbOrTransaction,
  day: string,
): Promise<{ centreId: string; day: string; payments: number; paise: number }[]> {
  return db
    .select({
      centreId: bill.centreId,
      day: undoneDay,
      payments: sql<number>`count(*)::int`.mapWith(Number),
      paise: sql<number>`sum(${payment.amountPaise})::bigint`.mapWith(Number),
    })
    .from(payment)
    .innerJoin(bill, eq(bill.id, payment.billId))
    .where(
      and(
        isNotNull(payment.undoneAt),
        gte(payment.undoneAt, startOfIstDay(day)),
        lt(payment.undoneAt, startOfIstDay(addDays(day, 1))),
      ),
    )
    .groupBy(bill.centreId, undoneDay);
}

/** Revenue (payments not undone) per centre, IST month and bill kind, from `from` to `to`. */
export async function revenueMonthly(
  db: DbOrTransaction,
  from: string,
  to: string,
): Promise<{ centreId: string; month: string; kind: BillKind; paise: number }[]> {
  return db
    .select({
      centreId: bill.centreId,
      month: recordedMonth,
      kind: bill.kind,
      paise: sql<number>`sum(${payment.amountPaise})::bigint`.mapWith(Number),
    })
    .from(payment)
    .innerJoin(bill, eq(bill.id, payment.billId))
    .where(
      and(
        isNull(payment.undoneAt),
        gte(payment.recordedAt, startOfIstDay(from)),
        lt(payment.recordedAt, startOfIstDay(addDays(to, 1))),
      ),
    )
    .groupBy(bill.centreId, recordedMonth, bill.kind);
}

export interface UnpaidBillRow {
  id: string;
  number: string;
  centreName: string;
  kind: BillKind;
  totalPaise: number;
  createdAt: Date;
  opNumber: string;
}

/** Unpaid bills, the largest first: the bill and patient numbers, never the patient's name. */
export function unpaidBills(db: DbOrTransaction): Promise<UnpaidBillRow[]> {
  return db
    .select({
      id: bill.id,
      number: bill.number,
      centreName: centre.name,
      kind: bill.kind,
      totalPaise: bill.totalPaise,
      createdAt: bill.createdAt,
      opNumber: patient.opNumber,
    })
    .from(bill)
    .innerJoin(centre, eq(centre.id, bill.centreId))
    .innerJoin(patient, eq(patient.id, bill.patientId))
    .where(eq(bill.status, 'unpaid'))
    .orderBy(desc(bill.totalPaise), bill.createdAt);
}

/**
 * Live packages per centre as of `today` (the rules of the Packages list, BIL-08): active,
 * expiring within `expiringDays`, and expired with sessions left, with their sessions left.
 */
export async function packageCounts(
  db: DbOrTransaction,
  today: string,
  expiringDays: number,
): Promise<
  {
    centreId: string;
    active: number;
    expiring: number;
    expired: number;
    sessionsLeftActive: number;
    sessionsLeftExpired: number;
  }[]
> {
  const left = sql`${patientPackage.sessionsTotal} - ${patientPackage.sessionsUsed}`;
  const active = sql`${patientPackage.validUntil} >= ${today}::date`;
  const expiring = sql`${patientPackage.validUntil} between ${today}::date and ${today}::date + ${expiringDays}::int`;
  const expired = sql`${patientPackage.validUntil} < ${today}::date`;
  return db
    .select({
      centreId: patientPackage.centreId,
      active: sql<number>`count(*) filter (where ${active})::int`.mapWith(Number),
      expiring: sql<number>`count(*) filter (where ${expiring})::int`.mapWith(Number),
      expired: sql<number>`count(*) filter (where ${expired})::int`.mapWith(Number),
      sessionsLeftActive:
        sql<number>`coalesce(sum(${left}) filter (where ${active}), 0)::int`.mapWith(Number),
      sessionsLeftExpired:
        sql<number>`coalesce(sum(${left}) filter (where ${expired}), 0)::int`.mapWith(Number),
    })
    .from(patientPackage)
    .where(
      and(
        isNull(patientPackage.cancelledAt),
        lt(patientPackage.sessionsUsed, patientPackage.sessionsTotal),
      ),
    )
    .groupBy(patientPackage.centreId);
}
