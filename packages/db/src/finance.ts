import { addDays, startOfIstDay, type BillKind, type PaymentMethod } from '@clinic-mx/schemas';
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { bill, centre, patient, patientPackage, payment, refundCredit } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Finance's dashboards (DSH-04, docs/runbooks/finance-dashboards.md): money figures read under the
 * reader's own row level security, which lets the Super Admin and Finance read every bill, payment
 * and package (and the Front Desk only its centres', who has no dashboard). Run under
 * `withStaffAccess`; the service checks `dashboard.finance` first.
 */

const recordedDay = sql<string>`((${payment.recordedAt} at time zone 'Asia/Kolkata')::date)::text`;
const undoneDay = sql<string>`((${payment.undoneAt} at time zone 'Asia/Kolkata')::date)::text`;

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

/**
 * Revenue per centre, IST month and bill kind, from `from` to `to`: payments not undone, less
 * refunds (BIL-11) in the month each was given, so a month's figure may be below zero.
 */
export async function revenueMonthly(
  db: DbOrTransaction,
  from: string,
  to: string,
): Promise<{ centreId: string; month: string; kind: BillKind; paise: number }[]> {
  const start = startOfIstDay(from).toISOString();
  const end = startOfIstDay(addDays(to, 1)).toISOString();
  const rows = await db.execute<{
    centre_id: string;
    month: string;
    kind: BillKind;
    paise: string;
  }>(
    sql`select m.centre_id, m.month, m.kind, sum(m.paise)::bigint as paise from (
      select b.centre_id, to_char(p.recorded_at at time zone 'Asia/Kolkata', 'YYYY-MM') as month,
        b.kind, p.amount_paise as paise
      from payment p join bill b on b.id = p.bill_id
      where p.undone_at is null and p.recorded_at >= ${start}::timestamptz and p.recorded_at < ${end}::timestamptz
      union all
      select b.centre_id, to_char(c.approved_at at time zone 'Asia/Kolkata', 'YYYY-MM'), b.kind,
        -c.amount_paise
      from refund_credit c join bill b on b.id = c.bill_id
      where c.approved_at >= ${start}::timestamptz and c.approved_at < ${end}::timestamptz
    ) m group by m.centre_id, m.month, m.kind`,
  );
  return rows.map((row) => ({
    centreId: row.centre_id,
    month: row.month,
    kind: row.kind,
    paise: Number(row.paise),
  }));
}

const refundDay = sql<string>`((${refundCredit.approvedAt} at time zone 'Asia/Kolkata')::date)::text`;

/** Refunds given per centre and IST day, from `from` to `to` (BIL-11): how many, and the paise. */
export async function refundsDaily(
  db: DbOrTransaction,
  from: string,
  to: string,
): Promise<{ centreId: string; day: string; refunds: number; paise: number }[]> {
  return db
    .select({
      centreId: bill.centreId,
      day: refundDay,
      refunds: sql<number>`count(*)::int`.mapWith(Number),
      paise: sql<number>`sum(${refundCredit.amountPaise})::bigint`.mapWith(Number),
    })
    .from(refundCredit)
    .innerJoin(bill, eq(bill.id, refundCredit.billId))
    .where(
      and(
        gte(refundCredit.approvedAt, startOfIstDay(from)),
        lt(refundCredit.approvedAt, startOfIstDay(addDays(to, 1))),
      ),
    )
    .groupBy(bill.centreId, refundDay);
}

export interface UnpaidBillRow {
  id: string;
  number: string;
  centreName: string;
  kind: BillKind;
  totalPaise: number;
  createdAt: Date;
  opNumber: string;
  /** Its episode, for the plan and payment sheet (BIL-07: Finance applies other discounts there). */
  episodeId: string | null;
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
      episodeId: bill.episodeId,
    })
    .from(bill)
    .innerJoin(centre, eq(centre.id, bill.centreId))
    .innerJoin(patient, eq(patient.id, bill.patientId))
    .where(eq(bill.status, 'unpaid'))
    .orderBy(desc(bill.totalPaise), bill.createdAt);
}

/** A patient's pay as you go balance (BIL-10): their unpaid bills the reader sees. */
export interface YtpBalanceRow {
  patientId: string;
  opNumber: string;
  /** The centres of those bills, by name, joined with commas. */
  centreName: string;
  unpaidPaise: number;
  unpaidBills: number;
  /** How many of those bills are for sessions paid per session. */
  unpaidSessions: number;
  /** When the oldest of them was raised. */
  oldestAt: Date;
}

const unpaidSessionCount = sql<number>`(count(*) filter (where ${bill.kind} = 'session'))::int`;

/**
 * Pay as you go balances (BIL-10; payments are whole, so a balance is the unpaid bills): per
 * patient across the centres the reader sees amounts at, as the Today board and the check in
 * drawer count them, the largest first, by OP number, never the patient's name.
 */
export function ytpBalances(db: DbOrTransaction): Promise<YtpBalanceRow[]> {
  const unpaidPaise = sql<number>`sum(${bill.totalPaise})::bigint`.mapWith(Number);
  return db
    .select({
      patientId: bill.patientId,
      opNumber: patient.opNumber,
      centreName: sql<string>`string_agg(distinct ${centre.name}, ', ' order by ${centre.name})`,
      unpaidPaise,
      unpaidBills: sql<number>`count(*)::int`.mapWith(Number),
      unpaidSessions: unpaidSessionCount.mapWith(Number),
      oldestAt: sql<Date>`min(${bill.createdAt})`.mapWith(
        (value: string | Date) => new Date(value),
      ),
    })
    .from(bill)
    .innerJoin(centre, eq(centre.id, bill.centreId))
    .innerJoin(patient, eq(patient.id, bill.patientId))
    .where(eq(bill.status, 'unpaid'))
    .groupBy(bill.patientId, patient.opNumber)
    .orderBy(desc(unpaidPaise), patient.opNumber);
}

/** One patient's unpaid bills that the reader sees (BIL-10): the paise, the bills, the sessions. */
export async function patientUnpaid(
  db: DbOrTransaction,
  patientId: string,
): Promise<{ unpaidPaise: number; unpaidBills: number; unpaidSessions: number }> {
  const [row] = await db
    .select({
      unpaidPaise: sql<number>`coalesce(sum(${bill.totalPaise}), 0)::bigint`.mapWith(Number),
      unpaidBills: sql<number>`count(*)::int`.mapWith(Number),
      unpaidSessions: unpaidSessionCount.mapWith(Number),
    })
    .from(bill)
    .where(and(eq(bill.patientId, patientId), eq(bill.status, 'unpaid')));
  return row ?? { unpaidPaise: 0, unpaidBills: 0, unpaidSessions: 0 };
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
