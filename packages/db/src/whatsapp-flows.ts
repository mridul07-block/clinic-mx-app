import { changeableStatuses } from '@clinic-mx/schemas';
import { and, asc, eq, gte, inArray, isNull, type SQL } from 'drizzle-orm';
import {
  appointment,
  appointmentType,
  centre,
  patient,
  priceItem,
  staffUser,
  whatsappFlowSession,
  type WhatsappFlowSession,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * WhatsApp Flow sessions (WA-04): the server's own record of a Flow it sent, keyed by the Flow
 * token, with what the person picked so far. Written and read only on the owner connection by
 * the data endpoint; under row level security nobody reads them.
 */

export async function createFlowSession(
  db: DbOrTransaction,
  values: {
    phone: string;
    kind: 'booking' | 'reschedule';
    expiresAt: Date;
    state?: Record<string, unknown>;
  },
): Promise<string> {
  const [row] = await db
    .insert(whatsappFlowSession)
    .values(values)
    .returning({ id: whatsappFlowSession.id });
  if (!row) throw new Error('The Flow session was not recorded.');
  return row.id;
}

/** One session, or undefined; `lock` holds it until the transaction ends. */
export async function flowSessionRecord(
  db: DbOrTransaction,
  id: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<WhatsappFlowSession | undefined> {
  const query = db.select().from(whatsappFlowSession).where(eq(whatsappFlowSession.id, id));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

export async function saveFlowState(
  db: DbOrTransaction,
  id: string,
  state: Record<string, unknown>,
): Promise<void> {
  await db.update(whatsappFlowSession).set({ state }).where(eq(whatsappFlowSession.id, id));
}

/** Records the appointment a session booked, once. */
export async function markFlowBooked(
  db: DbOrTransaction,
  id: string,
  appointmentId: string,
): Promise<boolean> {
  const rows = await db
    .update(whatsappFlowSession)
    .set({ appointmentId })
    .where(and(eq(whatsappFlowSession.id, id), isNull(whatsappFlowSession.appointmentId)))
    .returning({ id: whatsappFlowSession.id });
  return rows.length > 0;
}

/** Each physio's consultation fee (SET-07: `staff_user.consultation_price_item_id`), when set. */
export async function consultationFees(
  db: DbOrTransaction,
  physioIds: readonly string[],
): Promise<Map<string, { label: string; amountPaise: number }>> {
  if (physioIds.length === 0) return new Map();
  const rows = await db
    .select({ id: staffUser.id, label: priceItem.label, amountPaise: priceItem.amountPaise })
    .from(staffUser)
    .innerJoin(priceItem, eq(priceItem.id, staffUser.consultationPriceItemId))
    .where(inArray(staffUser.id, [...physioIds]));
  return new Map(rows.map((row) => [row.id, { label: row.label, amountPaise: row.amountPaise }]));
}

/** An appointment the reschedule Flow (WA-05) may offer, with what its screens show. */
export interface MovableAppointment {
  id: string;
  number: string;
  patientId: string;
  patientName: string;
  phone: string;
  centreId: string;
  centreName: string;
  physioId: string;
  physioName: string;
  appointmentTypeId: string;
  typeKey: string;
  typeName: string;
  episodeId: string | null;
  startsAt: Date;
  status: string;
}

function movableAppointments(db: DbOrTransaction, where: SQL | undefined) {
  return db
    .select({
      id: appointment.id,
      number: appointment.number,
      patientId: appointment.patientId,
      patientName: patient.name,
      phone: patient.phone,
      centreId: appointment.centreId,
      centreName: centre.name,
      physioId: appointment.physioId,
      physioName: staffUser.name,
      appointmentTypeId: appointment.appointmentTypeId,
      typeKey: appointmentType.key,
      typeName: appointmentType.name,
      episodeId: appointment.episodeId,
      startsAt: appointment.startsAt,
      status: appointment.status,
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(staffUser, eq(staffUser.id, appointment.physioId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(where)
    .orderBy(asc(appointment.startsAt), asc(appointment.number));
}

/**
 * The Booked or Confirmed appointments from `now` on of everyone on this number (a family shares
 * one), soonest first: what the menu's reschedule Flow offers (WA-05).
 */
export function upcomingAppointmentsOnPhone(
  db: DbOrTransaction,
  phone: string,
  now: Date,
): Promise<MovableAppointment[]> {
  return movableAppointments(
    db,
    and(
      eq(patient.phone, phone),
      inArray(appointment.status, [...changeableStatuses]),
      gte(appointment.startsAt, now),
    ),
  );
}

/** One appointment as the reschedule Flow shows it, whatever its status. */
export async function movableAppointment(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<MovableAppointment | undefined> {
  const [row] = await movableAppointments(db, eq(appointment.id, appointmentId));
  return row;
}
