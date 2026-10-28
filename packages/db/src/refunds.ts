import type { PaymentMethod } from '@clinic-mx/schemas';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { bill, centre, patient, patientPackage, payment, refundCredit } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Refunds (BIL-11; docs/runbooks/refunds.md): money given back against a payment, recorded by
 * Finance or the Super Admin through `internal.refund_payment`, which checks who, how much (never
 * more than was paid) and why, and closes the payment's live package once all of it is refunded.
 * Read under the reader's own row level security; patient names never, only OP numbers.
 */

/** Records a refund against a payment, as the signed in person; its id. */
export async function refundPayment(
  db: DbOrTransaction,
  values: {
    paymentId: string;
    amountPaise: number;
    method: PaymentMethod;
    reference?: string;
    reason: string;
  },
): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`select internal.refund_payment(${values.paymentId}::uuid, ${values.amountPaise}::int,
      ${values.method}::payment_method, ${values.reference ?? null}, ${values.reason}) as id`,
  );
  if (!row) throw new Error('The refund was not recorded.');
  return row.id;
}

/** A payment as Finance refunds it: what was paid, refunded so far, and its live package. */
export interface RefundablePayment {
  paymentId: string;
  billNumber: string;
  invoiceNumber: string | null;
  centreId: string;
  centreName: string;
  opNumber: string;
  paidPaise: number;
  method: PaymentMethod;
  paidAt: Date;
  refundedPaise: number;
  /** Its package while live: refunding all of the payment closes it. */
  livePackage: { name: string; used: number; total: number } | null;
}

/**
 * The live payment (not undone) of a bill or invoice number, as the reader sees it; undefined
 * when there is none.
 */
export async function refundablePayment(
  db: DbOrTransaction,
  number: string,
): Promise<RefundablePayment | undefined> {
  const [row] = await db
    .select({
      paymentId: payment.id,
      billNumber: bill.number,
      invoiceNumber: payment.invoiceNumber,
      centreId: bill.centreId,
      centreName: centre.name,
      opNumber: patient.opNumber,
      paidPaise: payment.amountPaise,
      method: payment.method,
      paidAt: payment.recordedAt,
      refundedPaise: sql<number>`(select coalesce(sum(c.amount_paise), 0)::int
        from refund_credit c where c.payment_id = ${payment.id})`.mapWith(Number),
    })
    .from(payment)
    .innerJoin(bill, eq(bill.id, payment.billId))
    .innerJoin(centre, eq(centre.id, bill.centreId))
    .innerJoin(patient, eq(patient.id, bill.patientId))
    .where(
      and(isNull(payment.undoneAt), or(eq(bill.number, number), eq(payment.invoiceNumber, number))),
    )
    .limit(1);
  if (!row) return undefined;
  const [bought] = await db
    .select({
      name: patientPackage.name,
      used: patientPackage.sessionsUsed,
      total: patientPackage.sessionsTotal,
    })
    .from(patientPackage)
    .where(and(eq(patientPackage.paymentId, row.paymentId), isNull(patientPackage.cancelledAt)));
  return { ...row, livePackage: bought ?? null };
}

/** A refund as the history and the bill show it. */
export interface RefundEntry {
  id: string;
  paymentId: string;
  billNumber: string;
  centreName: string;
  amountPaise: number;
  method: PaymentMethod;
  reference: string | null;
  reason: string;
  approvedByName: string;
  approvedAt: Date;
}

/** The newest refunds the reader sees, newest first. */
export function refundHistory(db: DbOrTransaction, limit: number): Promise<RefundEntry[]> {
  return db
    .select({
      id: refundCredit.id,
      paymentId: refundCredit.paymentId,
      billNumber: bill.number,
      centreName: centre.name,
      amountPaise: refundCredit.amountPaise,
      method: refundCredit.method,
      reference: refundCredit.reference,
      reason: refundCredit.reason,
      approvedByName: refundCredit.approvedByName,
      approvedAt: refundCredit.approvedAt,
    })
    .from(refundCredit)
    .innerJoin(bill, eq(bill.id, refundCredit.billId))
    .innerJoin(centre, eq(centre.id, bill.centreId))
    .orderBy(desc(refundCredit.approvedAt), desc(refundCredit.id))
    .limit(limit);
}
