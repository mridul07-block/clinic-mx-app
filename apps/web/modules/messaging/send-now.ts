import 'server-only';
import {
  BOOKING_CONFIRMATION_JOB,
  flowSessionRecord,
  messageRecord,
  queuedSendKeys,
  runJobsNow,
  type Db,
} from '@clinic-mx/db';
import { mayReceive } from '@clinic-mx/schemas';
import { z } from 'zod';
import { serverEnv } from '../../lib/env';
import { getSetting } from '../settings/settings';
import { conversationJobs } from './conversation-jobs';
import { markReadTyping } from './transport';

/**
 * A conversation's replies, sent now rather than at the next job tick (up to a minute later), so
 * WhatsApp answers like a person would (WA-03; docs/runbooks/whatsapp.md, "Reply speed"). Each
 * job is claimed from the queue before it runs, so a tick at the same time skips it and nothing
 * is sent twice; a failure goes back to the queue, and the tick tries it again with its backoff.
 */

/**
 * Rounds of sending: a send can queue one more message in its place (the contact details after a
 * refused form), which goes in the next round (a technical limit, not a business rule).
 */
const SEND_ROUNDS = 3;

/** How long Meta may take to show "typing…" (a technical limit, not a business rule). */
const TYPING_TIMEOUT_MS = 5_000;

/** Sends now every message still queued for this number, oldest first. */
export async function sendQueuedNow(db: Db, phone: string): Promise<void> {
  for (let round = 0; round < SEND_ROUNDS; round++) {
    const keys = await queuedSendKeys(db, phone);
    if (keys.length === 0) return;
    // None claimed: each is waiting on its retry pause, or a tick has it.
    if ((await runJobsNow(db, conversationJobs, keys)).claimed === 0) return;
  }
}

/** After a message to us is routed and answered: its replies, sent now. */
export async function sendRepliesNow(db: Db, inboundId: string): Promise<void> {
  const inbound = await messageRecord(db, inboundId);
  if (inbound?.direction !== 'inbound' || !inbound.fromPhone) return;
  await sendQueuedNow(db, inbound.fromPhone);
}

/**
 * The moment a message reaches us: blue ticks on it and "typing…" until our reply arrives, as a
 * person answering would (reply speed, user decision 1 November 2026). Only where WhatsApp is set
 * up and the number may be written to (the test list); cosmetic, so it never throws.
 */
export async function showTyping(db: Db, inboundId: string): Promise<void> {
  try {
    const env = serverEnv();
    if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return;
    const inbound = await messageRecord(db, inboundId);
    if (inbound?.direction !== 'inbound' || !inbound.fromPhone || !inbound.waMessageId) return;
    const [testRecipientsOnly, testRecipients] = await Promise.all([
      getSetting('whatsapp.test_recipients_only'),
      getSetting('whatsapp.test_recipients'),
    ]);
    if (!mayReceive(inbound.fromPhone, { testRecipientsOnly, testRecipients })) return;
    await markReadTyping(
      {
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        graphVersion: env.WHATSAPP_GRAPH_VERSION,
      },
      inbound.waMessageId,
      AbortSignal.timeout(TYPING_TIMEOUT_MS),
    );
  } catch {
    // Only the ticks and "typing…" are lost; the reply still goes.
  }
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
