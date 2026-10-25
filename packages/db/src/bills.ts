import type { AppointmentStatus, BillKind, BillStatus, PaymentMethod } from '@clinic-mx/schemas';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { appointment, appointmentType, bill, billLine, payment, staffUser } from './schema';
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
  lines: { description: string; quantity: number; unitPaise: number; amountPaise: number }[];
  /** Its live payment (BIL-06), when paid. */
  payment: PaymentEntry | null;
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
      description: billLine.description,
      quantity: billLine.quantity,
      unitPaise: billLine.unitPaise,
      amountPaise: billLine.amountPaise,
    })
    .from(billLine)
    .where(
      inArray(
        billLine.billId,
        bills.map((entry) => entry.id),
      ),
    )
    .orderBy(asc(billLine.description));
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
  return bills.map((entry) => ({
    ...entry,
    payment: paymentOf(payments.find((paid) => paid.billId === entry.id)),
    lines: lines
      .filter((line) => line.billId === entry.id)
      .map(({ description, quantity, unitPaise, amountPaise }) => ({
        description,
        quantity,
        unitPaise,
        amountPaise,
      })),
  }));
}

function paymentOf(row: (PaymentEntry & { billId: string }) | undefined): PaymentEntry | null {
  if (!row) return null;
  return {
    id: row.id,
    method: row.method,
    amountPaise: row.amountPaise,
    reference: row.reference,
    recordedByName: row.recordedByName,
    recordedAt: row.recordedAt,
    undoable: row.undoable,
    invoiceNumber: row.invoiceNumber,
    invoiceDocumentId: row.invoiceDocumentId,
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
 * database refuses a bill already paid, or one this person does not take payment for.
 */
export async function recordPayment(
  db: DbOrTransaction,
  values: { billId: string; method: PaymentMethod; reference?: string },
): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`select internal.record_payment(${values.billId}::uuid, ${values.method}::payment_method,
      ${values.reference ?? null}) as id`,
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

/** The centre a bill is at, or a payment's bill is at; undefined when the reader cannot see it. */
export async function billCentre(
  db: DbOrTransaction,
  ref: { billId: string } | { paymentId: string },
): Promise<string | undefined> {
  const [row] =
    'billId' in ref
      ? await db.select({ centreId: bill.centreId }).from(bill).where(eq(bill.id, ref.billId))
      : await db
          .select({ centreId: bill.centreId })
          .from(payment)
          .innerJoin(bill, eq(bill.id, payment.billId))
          .where(eq(payment.id, ref.paymentId));
  return row?.centreId;
}
