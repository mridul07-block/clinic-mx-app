import 'server-only';
import {
  BOOKING_CONFIRMATION_JOB,
  flowSessionRecord,
  messageRecord,
  queuedSendKeys,
  runJobsNow,
  type Db,
} from '@clinic-mx/db';
import { z } from 'zod';
import { conversationJobs } from './conversation-jobs';

/**
 * A conversation's replies, sent now rather than at the next job tick (up to a minute later), so
 * WhatsApp answers like a person would (WA-03; docs/runbooks/whatsapp.md, "Reply speed"). Each
 * job is claimed from the queue before it runs, so a tick at the same time skips it and nothing
 * is sent twice; a failure goes back to the queue, and the tick tries it again with its backoff.
 */

/** Sends now every message still queued for this number, oldest first. */
export async function sendQueuedNow(db: Db, phone: string): Promise<void> {
  await runJobsNow(db, conversationJobs, await queuedSendKeys(db, phone));
}

/** After a message to us is routed and answered: its replies, sent now. */
export async function sendRepliesNow(db: Db, inboundId: string): Promise<void> {
  const inbound = await messageRecord(db, inboundId);
  if (inbound?.direction !== 'inbound' || !inbound.fromPhone) return;
  await sendQueuedNow(db, inbound.fromPhone);
}

/**
 * After a Flow screen (WA-04, WA-05): once its session booked or moved an appointment, that
 * appointment's booking confirmation is written and sent now.
 */
export async function sendFlowMessagesNow(db: Db, flowToken: string): Promise<void> {
  const token = z.guid().safeParse(flowToken);
  if (!token.success) return;
  const session = await flowSessionRecord(db, token.data);
  if (!session?.appointmentId) return;
  await runJobsNow(db, conversationJobs, [`${BOOKING_CONFIRMATION_JOB}:${session.appointmentId}`]);
  await sendQueuedNow(db, session.phone);
}
