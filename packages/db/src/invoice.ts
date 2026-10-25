import type { BillKind, PaymentMethod } from '@clinic-mx/schemas';
import { asc, eq } from 'drizzle-orm';
import { centreRecord } from './centres';
import { bill, billLine, packageType, patient, payment, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Invoices and receipts (BIL-09, Frontend Specification section 11): recording a payment queues
 * its invoice PDF and its WhatsApp receipt; undoing it queues the invoice again, printed as
 * cancelled (docs/runbooks/bills.md).
 */
export const INVOICE_JOB = 'documents.invoice';
export const RECEIPT_JOB = 'whatsapp.receipt';

export interface InvoiceFacts {
  paymentId: string;
  invoiceNumber: string;
  billNumber: string;
  billKind: BillKind;
  patientId: string;
  episodeId: string | null;
  centreId: string;
  centre: { name: string; address: string | null; phone: string | null };
  patient: { name: string; opNumber: string };
  lines: { description: string; quantity: number; unitPaise: number; amountPaise: number }[];
  totalPaise: number;
  method: PaymentMethod;
  reference: string | null;
  receivedBy: string | null;
  paidAt: Date;
  /** The package bought, for a package bill. */
  package: { name: string; sessions: number } | null;
  undone: { at: Date; reason: string } | null;
}

/** What a payment's invoice prints, read as the system; undefined for no numbered payment. */
export async function invoiceFacts(
  db: DbOrTransaction,
  paymentId: string,
): Promise<InvoiceFacts | undefined> {
  const [row] = await db
    .select({
      invoiceNumber: payment.invoiceNumber,
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.recordedAt,
      undoneAt: payment.undoneAt,
      undoReason: payment.undoReason,
      receivedBy: staffUser.name,
      billId: bill.id,
      billNumber: bill.number,
      billKind: bill.kind,
      totalPaise: bill.totalPaise,
      patientId: bill.patientId,
      episodeId: bill.episodeId,
      centreId: bill.centreId,
      patientName: patient.name,
      opNumber: patient.opNumber,
    })
    .from(payment)
    .innerJoin(bill, eq(bill.id, payment.billId))
    .innerJoin(patient, eq(patient.id, bill.patientId))
    .leftJoin(staffUser, eq(staffUser.id, payment.recordedBy))
    .where(eq(payment.id, paymentId));
  if (!row?.invoiceNumber) return undefined;
  const centre = await centreRecord(db, row.centreId);
  if (!centre) return undefined;
  const lines = await db
    .select({
      description: billLine.description,
      quantity: billLine.quantity,
      unitPaise: billLine.unitPaise,
      amountPaise: billLine.amountPaise,
      packageName: packageType.name,
      packageSessions: packageType.sessions,
    })
    .from(billLine)
    .leftJoin(packageType, eq(packageType.id, billLine.packageTypeId))
    .where(eq(billLine.billId, row.billId))
    .orderBy(asc(billLine.description));
  const bought = lines.find((line) => line.packageName !== null);
  return {
    paymentId,
    invoiceNumber: row.invoiceNumber,
    billNumber: row.billNumber,
    billKind: row.billKind,
    patientId: row.patientId,
    episodeId: row.episodeId,
    centreId: row.centreId,
    centre: { name: centre.name, address: centre.address, phone: centre.phone },
    patient: { name: row.patientName, opNumber: row.opNumber },
    lines: lines.map(({ description, quantity, unitPaise, amountPaise }) => ({
      description,
      quantity,
      unitPaise,
      amountPaise,
    })),
    totalPaise: row.totalPaise,
    method: row.method,
    reference: row.reference,
    receivedBy: row.receivedBy,
    paidAt: row.paidAt,
    package:
      bought?.packageName && bought.packageSessions !== null
        ? { name: bought.packageName, sessions: bought.packageSessions }
        : null,
    undone: row.undoneAt && row.undoReason ? { at: row.undoneAt, reason: row.undoReason } : null,
  };
}
