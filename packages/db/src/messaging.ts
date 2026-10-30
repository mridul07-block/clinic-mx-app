import type { MessageKind, MessageStatus } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { message, type Message } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * WhatsApp messages (WA-01). A message is queued as a row; the `message_queue_send` trigger
 * queues its `whatsapp.send` job in the same transaction. The job records the outcome as
 * `system:whatsapp` on the owner connection; under row level security only the Super Admin reads
 * messages and queues a test send.
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
  toPhone: string;
  kind: MessageKind;
  templateKey: string;
  status: MessageStatus;
  errorCode: string | null;
  errorTitle: string | null;
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
}

/** The newest messages the reader sees (the Super Admin), newest first. */
export function recentMessages(db: DbOrTransaction, limit: number): Promise<MessageEntry[]> {
  return db
    .select({
      id: message.id,
      toPhone: message.toPhone,
      kind: message.kind,
      templateKey: message.templateKey,
      status: message.status,
      errorCode: message.errorCode,
      errorTitle: message.errorTitle,
      attempts: message.attempts,
      createdAt: message.createdAt,
      sentAt: message.sentAt,
    })
    .from(message)
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(limit);
}
