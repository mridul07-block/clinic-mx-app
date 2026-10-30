import {
  deliveryChange,
  type DeliveryUpdate,
  type InboundMessage,
  type MessageDirection,
  type MessageKind,
  type MessageStatus,
} from '@clinic-mx/schemas';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { message, whatsappEvent, type Message, type WhatsappEvent } from './schema';
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
}

/** Queues a message; its send job is queued with it. Returns the message id. */
export async function queueMessage(tx: DbOrTransaction, values: NewMessage): Promise<string> {
  const [row] = await tx.insert(message).values(values).returning({ id: message.id });
  if (!row) throw new Error('The message was not recorded.');
  return row.id;
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

/** Stores a message sent to us, Received; one Meta sends again is ignored. Returns if stored. */
export async function recordInboundMessage(
  tx: DbOrTransaction,
  inbound: InboundMessage,
): Promise<boolean> {
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
  return rows.length > 0;
}
