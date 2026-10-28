import type {
  AppointmentStatus,
  BillKind,
  BillStatus,
  DiscountKind,
  PaymentMethod,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  appointment,
  appointmentType,
  bill,
  billLine,
  payment,
  refundCredit,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Bills at fixed prices (BIL-05; docs/runbooks/bills.md). The database makes them at the price
 * master's amounts (the consultation fee when it is due, a package when one is chosen); row level
 * security shows them to those who see amounts at the bill's centre, and nobody signed in writes
 * one.
 */

export interface BillEntry {
  id: string;
  number: string;
  kind: BillKind;
  status: BillStatus;
  totalPaise: number;
  createdAt: Date;
  cancelReason: string | null;
  lines: BillLineEntry[];
  /** Its live payment (BIL-06), when paid. */
  payment: PaymentEntry | null;
}

/** A line of a bill, with its discount (BIL-07) when it has one. */
export interface BillLineEntry {
  id: string;
  description: string;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
  discount: LineDiscount | null;
}

/** A line's discount as applied: a copy of the preset, or Finance's Other discount. */
export interface LineDiscount {
  kind: DiscountKind;
  /** A preset's; null for an Other discount. */
  presetId: string | null;
  name: string;
  percent: number | null;
  paise: number;
  reason: string | null;
  byName: string | null;
  at: Date;
}

export interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  amountPaise: number;
  reference: string | null;
  recordedByName: string | null;
  recordedAt: Date;
  /** Recorded today in IST: it may still be undone at the desk. */
  undoable: boolean;
  /** Its invoice's number (BIL-09); null for payments from before invoices. */
  invoiceNumber: string | null;
  /** Its invoice PDF's newest version, once the job has made it. */
  invoiceDocumentId: string | null;
  /** Refunds given against it (BIL-11), oldest first. */
  refunds: PaymentRefund[];
}

/** A refund against a payment, as the bill shows it (BIL-11). */
export interface PaymentRefund {
  amountPaise: number;
  method: PaymentMethod;
  reason: string;
  approvedByName: string;
  approvedAt: Date;
}

/** An episode's bills, newest first, with their lines. */
export async function billsOfEpisode(db: DbOrTransaction, episodeId: string): Promise<BillEntry[]> {
  const bills = await db
    .select({
      id: bill.id,
      number: bill.number,
      kind: bill.kind,
      status: bill.status,
      totalPaise: bill.totalPaise,
      createdAt: bill.createdAt,
      cancelReason: bill.cancelReason,
    })
    .from(bill)
    .where(eq(bill.episodeId, episodeId))
    .orderBy(desc(bill.createdAt));
  if (bills.length === 0) return [];
  const lines = await db
    .select({
      billId: billLine.billId,
      id: billLine.id,
      description: billLine.description,
      quantity: billLine.quantity,
      unitPaise: billLine.unitPaise,
      amountPaise: billLine.amountPaise,
      discountKind: billLine.discountKind,
      discountPresetId: billLine.discountPresetId,
      discountName: billLine.discountName,
      discountPercent: billLine.discountPercent,
      discountPaise: billLine.discountPaise,
      discountReason: billLine.discountReason,
      discountedByName: billLine.discountedByName,
      discountedAt: billLine.discountedAt,
    })
    .from(billLine)
    .where(
      inArray(
        billLine.billId,
        bills.map((entry) => entry.id),
      ),
    )
    .orderBy(asc(billLine.description), asc(billLine.id));
  const payments = await db
    .select({
      billId: payment.billId,
      id: payment.id,
      method: payment.method,
      amountPaise: payment.amountPaise,
      reference: payment.reference,
      recordedByName: staffUser.name,
      recordedAt: payment.recordedAt,
      undoable: sql<boolean>`(${payment.recordedAt} at time zone 'Asia/Kolkata')::date
        = (now() at time zone 'Asia/Kolkata')::date`,
      invoiceNumber: payment.invoiceNumber,
      invoiceDocumentId: sql<string | null>`(
        select d.id from document d
        where d.kind = 'invoice_receipt' and d.source_id = ${payment.id}
        order by d.version desc limit 1
      )`,
    })
    .from(payment)
    .leftJoin(staffUser, eq(staffUser.id, payment.recordedBy))
    .where(
      and(
        inArray(
          payment.billId,
          bills.map((entry) => entry.id),
        ),
        isNull(payment.undoneAt),
      ),
    );
  const refunds =
    payments.length === 0
      ? []
      : await db
          .select({
            paymentId: refundCredit.paymentId,
            amountPaise: refundCredit.amountPaise,
            method: refundCredit.method,
            reason: refundCredit.reason,
            approvedByName: refundCredit.approvedByName,
            approvedAt: refundCredit.approvedAt,
          })
          .from(refundCredit)
          .where(
            inArray(
              refundCredit.paymentId,
              payments.map((paid) => paid.id),
            ),
          )
          .orderBy(asc(refundCredit.approvedAt), asc(refundCredit.id));
  return bills.map((entry) => ({
    ...entry,
    payment: paymentOf(
      payments.find((paid) => paid.billId === entry.id),
      refunds,
    ),
    lines: lines
      .filter((line) => line.billId === entry.id)
      .map((line) => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPaise: line.unitPaise,
        amountPaise: line.amountPaise,
        discount:
          line.discountKind && line.discountName && line.discountedAt
            ? {
                kind: line.discountKind,
                presetId: line.discountPresetId,
                name: line.discountName,
                percent: line.discountPercent,
                paise: line.discountPaise,
                reason: line.discountReason,
                byName: line.discountedByName,
                at: line.discountedAt,
              }
            : null,
      })),
  }));
}

function paymentOf(
  row: (Omit<PaymentEntry, 'refunds'> & { billId: string }) | undefined,
  refunds: (PaymentRefund & { paymentId: string })[],
): PaymentEntry | null {
  if (!row) return null;
  const given = refunds
    .filter((refund) => refund.paymentId === row.id)
    .map(({ paymentId: _paymentId, ...refund }) => refund);
  return {
    id: row.id,
    method: row.method,
    amountPaise: row.amountPaise,
    reference: row.reference,
    recordedByName: row.recordedByName,
    recordedAt: row.recordedAt,
    // A refunded payment is Finance's: the desk's same-day undo would give the money back twice.
    undoable: row.undoable && given.length === 0,
    invoiceNumber: row.invoiceNumber,
    invoiceDocumentId: row.invoiceDocumentId,
    refunds: given,
  };
}

/** The episode's consultation visit as billing sees it: who consulted, their fee, its bill. */
export interface ConsultationFeeState {
  appointmentId: string;
  status: AppointmentStatus;
  consultantName: string;
  /** The consultant's fee price item's label, when one is set and active. */
  feeLabel: string | null;
  billed: boolean;
}

/** The episode's newest consultation visit that still counts; undefined when there is none. */
export async function consultationFeeState(
  db: DbOrTransaction,
  episodeId: string,
): Promise<ConsultationFeeState | undefined> {
  const [row] = await db
    .select({
      appointmentId: appointment.id,
      status: appointment.status,
      consultantName: staffUser.name,
      feeLabel: sql<string | null>`(
        select p.label from price_item p
        where p.id = ${staffUser.consultationPriceItemId} and p.active
      )`,
      billed: sql<boolean>`exists (
        select 1 from bill b
        where b.appointment_id = ${appointment.id} and b.kind = 'consultation'
          and b.status <> 'cancelled'
      )`,
    })
    .from(appointment)
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .innerJoin(staffUser, eq(staffUser.id, appointment.physioId))
    .where(
      and(
        eq(appointment.episodeId, episodeId),
        eq(appointmentType.key, 'consultation'),
        notInArray(appointment.status, ['cancelled', 'rescheduled', 'no_show']),
      ),
    )
    .orderBy(desc(appointment.startsAt))
    .limit(1);
  return row;
}

/**
 * Makes a visit's consultation fee bill now, as the signed in person (the sheet's "Make the
 * consultation bill"): the bill's id, or null when it is not due or the consultant has no fee.
 */
export async function consultationBillNow(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<string | null> {
  const [row] = await db.execute<{ id: string | null }>(
    sql`select internal.consultation_bill_now(${appointmentId}::uuid) as id`,
  );
  return row?.id ?? null;
}

/**
 * Marks a bill paid by a method, for its whole total, as the signed in person (BIL-06); the
 * database refuses a bill already paid, or one this person does not take payment for. With the
 * total the desk was shown (BIL-07), it refuses a total changed meanwhile and keeps the lines as
 * charged for the invoice.
 */
export async function recordPayment(
  db: DbOrTransaction,
  values: {
    billId: string;
    method: PaymentMethod;
    reference?: string;
    expectedTotalPaise?: number;
  },
): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    values.expectedTotalPaise === undefined
      ? sql`select internal.record_payment(${values.billId}::uuid, ${values.method}::payment_method,
      ${values.reference ?? null}) as id`
      : sql`select internal.record_payment_of(${values.billId}::uuid,
      ${values.method}::payment_method, ${values.reference ?? null},
      ${values.expectedTotalPaise}::int) as id`,
  );
  if (!row) throw new Error('The payment was not recorded.');
  return row.id;
}

/** Undoes a payment recorded by mistake, on its day, with the reason; the bill is unpaid again. */
export async function undoPayment(
  db: DbOrTransaction,
  values: { paymentId: string; reason: string },
): Promise<void> {
  await db.execute(sql`select internal.undo_payment(${values.paymentId}::uuid, ${values.reason})`);
}

/**
 * The centre a bill is at, or a payment's or a line's bill is at; undefined when the reader
 * cannot see it.
 */
export async function billCentre(
  db: DbOrTransaction,
  ref: { billId: string } | { paymentId: string } | { lineId: string },
): Promise<string | undefined> {
  const [row] =
    'billId' in ref
      ? await db.select({ centreId: bill.centreId }).from(bill).where(eq(bill.id, ref.billId))
      : 'paymentId' in ref
        ? await db
            .select({ centreId: bill.centreId })
            .from(payment)
            .innerJoin(bill, eq(bill.id, payment.billId))
            .where(eq(payment.id, ref.paymentId))
        : await db
            .select({ centreId: bill.centreId })
            .from(billLine)
            .innerJoin(bill, eq(bill.id, billLine.billId))
            .where(eq(billLine.id, ref.lineId));
  return row?.centreId;
}

/**
 * Applies a discount to a line of an unpaid bill, as the signed in person (BIL-07): a preset, or
 * with no preset an Other discount of a percent or an amount with its reason (Finance and the
 * Super Admin only). The database copies the preset, refuses a discount down to ₹0, and returns
 * the bill's new total.
 */
export async function applyDiscount(
  db: DbOrTransaction,
  values: {
    lineId: string;
    presetId: string | null;
    percent?: number | null;
    amountPaise?: number | null;
    reason?: string | null;
  },
): Promise<number> {
  const [row] = await db.execute<{ total: number }>(
    sql`select internal.apply_discount(${values.lineId}::uuid, ${values.presetId}::uuid,
      ${values.percent ?? null}::int, ${values.amountPaise ?? null}::int,
      ${values.reason ?? null}) as total`,
  );
  if (!row) throw new Error('The discount was not applied.');
  return row.total;
}

/** Takes a line's discount off an unpaid bill (BIL-07); the bill's new total. */
export async function removeDiscount(db: DbOrTransaction, lineId: string): Promise<number> {
  const [row] = await db.execute<{ total: number }>(
    sql`select internal.remove_discount(${lineId}::uuid) as total`,
  );
  if (!row) throw new Error('The discount was not removed.');
  return row.total;
}
