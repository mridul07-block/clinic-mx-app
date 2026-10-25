import type { AppointmentStatus, BillKind, BillStatus } from '@clinic-mx/schemas';
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { appointment, appointmentType, bill, billLine, staffUser } from './schema';
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
  return bills.map((entry) => ({
    ...entry,
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
