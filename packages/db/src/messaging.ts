import {
  deliveryChange,
  type DeliveryUpdate,
  type InboundRoute,
  type InboundMessage,
  type MessageDirection,
  type MessageKind,
  type MessageStatus,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, isNull, max, sql } from 'drizzle-orm';
import {
  centre,
  message,
  patient,
  whatsappEvent,
  type Message,
  type WhatsappEvent,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * WhatsApp messages (WA-01). A message is queued as a row; the `message_queue_send` trigger
 * queues its `whatsapp.send` job in the same transaction. The job records the outcome as
 * `system:whatsapp` on the owner connection; under row level security only the Super Admin reads
 * messages and queues a test send. The webhook (WA-02) stores Meta's body in `whatsapp_event`;
 * its job moves sent messages on (Delivered, Read, Failed) and stores inbound ones, Received.
 */

export interface NewMessage {
  patientId: string | null;
  toPhone: string;
  kind: MessageKind;
  templateKey: string;
  templateVersion: number;
  language: string;
  variables: Record<string, string>;
  createdBy: string;
  /** A router reply (WA-03): Meta's id of the message it answers. */
  contextWaId?: string | null;
  /** WA-06: the patient link a check's message stands for. */
  patientLinkId?: string | null;
  /** WA-06: the job that queued it; a second message with the same key is not queued. */
  sourceKey?: string | null;
  /** WA-08: the appointment a reminder is about, for its Confirm. */
  appointmentId?: string | null;
}

/** Queues a message; its send job is queued with it. Returns the message id. */
export async function queueMessage(tx: DbOrTransaction, values: NewMessage): Promise<string> {
  const [row] = await tx.insert(message).values(values).returning({ id: message.id });
  if (!row) throw new Error('The message was not recorded.');
  return row.id;
}

/**
 * Queues a clinic message once for its source (WA-06): a job that runs again queues nothing more.
 * Returns the message id, or null when the source already queued one.
 */
export async function queueMessageOnce(
  tx: DbOrTransaction,
  values: NewMessage & { sourceKey: string },
): Promise<string | null> {
  const [row] = await tx
    .insert(message)
    .values(values)
    .onConflictDoNothing({ target: message.sourceKey })
    .returning({ id: message.id });
  return row?.id ?? null;
}

/** One message, or undefined. */
export async function messageRecord(db: DbOrTransaction, id: string): Promise<Message | undefined> {
  const [row] = await db.select().from(message).where(eq(message.id, id));
  return row;
}

export type MessageOutcome =
  | { status: 'sent'; waMessageId: string }
  | { status: 'failed' | 'skipped'; errorCode: string | null; errorTitle: string }
  /** A failure the job queue tries again: only the attempt is counted. */
  | { status: 'queued'; errorCode: string | null; errorTitle: string };

/**
 * Records what sending a queued message came to, counting the attempt. Only a message still
 * Queued changes, so a job that runs again never undoes an outcome. Returns whether it changed.
 */
export async function recordMessageOutcome(
  tx: DbOrTransaction,
  id: string,
  outcome: MessageOutcome,
): Promise<boolean> {
  const now = new Date();
  const common = { attempts: sql`${message.attempts} + 1`, statusAt: now };
  const changes =
    outcome.status === 'sent'
      ? {
          ...common,
          status: 'sent' as const,
          waMessageId: outcome.waMessageId,
          sentAt: now,
          errorCode: null,
          errorTitle: null,
        }
      : {
          ...common,
          status: outcome.status,
          errorCode: outcome.errorCode,
          errorTitle: outcome.errorTitle,
        };
  const rows = await tx
    .update(message)
    .set(changes)
    .where(and(eq(message.id, id), eq(message.status, 'queued')))
    .returning({ id: message.id });
  return rows.length > 0;
}

export interface MessageEntry {
  id: string;
  direction: MessageDirection;
  route: InboundRoute | null;
  /** The patient's number: who it went to, or who sent it. */
  phone: string;
  kind: MessageKind;
  templateKey: string | null;
  status: MessageStatus;
  errorCode: string | null;
  errorTitle: string | null;
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
}

/** The newest messages the reader sees (the Super Admin), newest first; never inbound text. */
export function recentMessages(db: DbOrTransaction, limit: number): Promise<MessageEntry[]> {
  return db
    .select({
      id: message.id,
      direction: message.direction,
      route: message.route,
      phone: sql<string>`coalesce(${message.toPhone}, ${message.fromPhone})`,
      kind: message.kind,
      templateKey: message.templateKey,
      status: message.status,
      errorCode: message.errorCode,
      errorTitle: message.errorTitle,
      attempts: message.attempts,
      createdAt: message.createdAt,
      sentAt: message.sentAt,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
    })
    .from(message)
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(limit);
}

/** Stores a webhook body Meta signed (WA-02); its `whatsapp.event` job is queued with it. */
export async function storeWhatsappEvent(db: DbOrTransaction, payload: unknown): Promise<string> {
  const [row] = await db
    .insert(whatsappEvent)
    .values({ payload })
    .returning({ id: whatsappEvent.id });
  if (!row) throw new Error('The webhook was not recorded.');
  return row.id;
}

/**
 * One stored webhook body, or undefined (already deleted). `lock` holds it until the transaction
 * ends, so two handlers of the same body run one after the other.
 */
export async function whatsappEventRecord(
  db: DbOrTransaction,
  id: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<WhatsappEvent | undefined> {
  const query = db.select().from(whatsappEvent).where(eq(whatsappEvent.id, id));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** Marks a webhook body handled, which starts its retention time. */
export async function markWhatsappEventProcessed(db: DbOrTransaction, id: string): Promise<void> {
  await db
    .update(whatsappEvent)
    .set({ processedAt: new Date() })
    .where(and(eq(whatsappEvent.id, id), isNull(whatsappEvent.processedAt)));
}

/**
 * Applies a delivery status to the message we sent with that Meta id: forward only
 * (`deliveryChange`). `unknown` when no message of ours has that id (yet: the send job records
 * Meta's id just after Meta answers, so a quick status can arrive first); `unchanged` for a status
 * late or repeated.
 */
export async function applyDeliveryUpdate(
  tx: DbOrTransaction,
  update: DeliveryUpdate,
): Promise<'changed' | 'unchanged' | 'unknown'> {
  const [current] = await tx
    .select({
      id: message.id,
      status: message.status,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
    })
    .from(message)
    .where(and(eq(message.waMessageId, update.waMessageId), eq(message.direction, 'outbound')))
    .for('update');
  if (!current) return 'unknown';
  const change = deliveryChange(current, update);
  if (!change) return 'unchanged';
  await tx
    .update(message)
    .set({ ...change, statusAt: new Date() })
    .where(eq(message.id, current.id));
  return 'changed';
}

/**
 * Stores a message sent to us, Received; its route job is queued with it (WA-03). One Meta sends
 * again is ignored. Returns its id, or null when it was already stored.
 */
export async function recordInboundMessage(
  tx: DbOrTransaction,
  inbound: InboundMessage,
): Promise<string | null> {
  const rows = await tx
    .insert(message)
    .values({
      direction: 'inbound',
      kind: inbound.kind,
      status: 'received',
      fromPhone: inbound.fromPhone,
      waMessageId: inbound.waMessageId,
      sentAt: inbound.at,
      statusAt: inbound.at,
      body: inbound.body,
      replyId: inbound.replyId,
      replyPayload: inbound.replyPayload,
      contextWaId: inbound.contextWaId,
      createdBy: 'system:whatsapp',
    })
    .onConflictDoNothing({ target: message.waMessageId })
    .returning({ id: message.id });
  return rows[0]?.id ?? null;
}

/** An inbound message waiting for its route (WA-03), locked until the transaction ends. */
export async function inboundToRoute(
  tx: DbOrTransaction,
  id: string,
): Promise<Message | undefined> {
  const [row] = await tx
    .select()
    .from(message)
    .where(and(eq(message.id, id), eq(message.direction, 'inbound')))
    .for('update');
  return row;
}

/** Records where the router sent a message, and the patient when the number is theirs alone. */
export async function recordRoute(
  tx: DbOrTransaction,
  id: string,
  route: InboundRoute,
  patientId: string | null,
): Promise<boolean> {
  const rows = await tx
    .update(message)
    .set({ route, routedAt: new Date(), patientId })
    .where(and(eq(message.id, id), isNull(message.route)))
    .returning({ id: message.id });
  return rows.length > 0;
}

/**
 * The one patient with this number, or undefined when none or several (a family shares a mobile,
 * so nobody is guessed).
 */
export async function solePatientByPhone(
  db: DbOrTransaction,
  phone: string,
): Promise<{ id: string; centreId: string } | undefined> {
  const rows = await db
    .select({ id: patient.id, centreId: patient.registeredCentreId })
    .from(patient)
    .where(eq(patient.phone, phone))
    .limit(2);
  return rows.length === 1 ? rows[0] : undefined;
}

/** The centres' names and phones for "Talk to our team": one centre, or every active one. */
export function centreContacts(
  db: DbOrTransaction,
  centreId?: string,
): Promise<{ name: string; phone: string | null }[]> {
  return db
    .select({ name: centre.name, phone: centre.phone })
    .from(centre)
    .where(centreId ? eq(centre.id, centreId) : eq(centre.active, true))
    .orderBy(asc(centre.name));
}

/** Every active centre's address and map link, for `{{centres}}` in an assistant answer (WA-11). */
export function centreDirections(
  db: DbOrTransaction,
): Promise<{ name: string; address: string | null; mapLink: string | null }[]> {
  return db
    .select({ name: centre.name, address: centre.address, mapLink: centre.mapLink })
    .from(centre)
    .where(eq(centre.active, true))
    .orderBy(asc(centre.name));
}

/** The names of every patient with this number (WA-11): replaced before a model sees their words. */
export async function patientNamesByPhone(db: DbOrTransaction, phone: string): Promise<string[]> {
  const rows = await db
    .select({ name: patient.name })
    .from(patient)
    .where(eq(patient.phone, phone));
  return rows.map((row) => row.name);
}

/** Whether a message was queued for this source already (WA-11: one answer per typed message). */
export async function sourceQueued(db: DbOrTransaction, sourceKey: string): Promise<boolean> {
  const [row] = await db
    .select({ id: message.id })
    .from(message)
    .where(eq(message.sourceKey, sourceKey))
    .limit(1);
  return row !== undefined;
}

/** When this number last wrote to us, for WhatsApp's 24 hour window. */
export async function lastInboundAt(db: DbOrTransaction, phone: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(message.sentAt) })
    .from(message)
    .where(and(eq(message.fromPhone, phone), eq(message.direction, 'inbound')));
  return row?.at ?? null;
}
