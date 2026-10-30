import { and, eq, inArray, isNull } from 'drizzle-orm';
import { priceItem, staffUser, whatsappFlowSession, type WhatsappFlowSession } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * WhatsApp Flow sessions (WA-04): the server's own record of a Flow it sent, keyed by the Flow
 * token, with what the person picked so far. Written and read only on the owner connection by
 * the data endpoint; under row level security nobody reads them.
 */

export async function createFlowSession(
  db: DbOrTransaction,
  values: { phone: string; kind: 'booking'; expiresAt: Date },
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
