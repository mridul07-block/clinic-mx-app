import 'server-only';
import {
  applyDeliveryUpdate,
  applyTemplateUpdate,
  markWhatsappEventProcessed,
  recordInboundMessage,
  storeWhatsappEvent,
  whatsappEventRecord,
  type Db,
} from '@clinic-mx/db';
import { webhookContents, whatsappWebhookSchema } from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';

/**
 * Meta's WhatsApp webhook (WA-02; TAD section 6). The route checks the signature and stores the
 * body, which queues the `whatsapp.event` job; the route also handles it straight after answering
 * Meta, so it counts within seconds (user decision, 30 October 2026), and the job is the fallback.
 * Handling is safe to repeat and to run twice at once: the event row is locked, a handled one is
 * skipped, statuses only move forward and a message Meta sends again is stored once.
 */

export const WHATSAPP_EVENT_JOB = 'whatsapp.event';

/**
 * How long a status for a message we do not know is waited on (a technical limit, not a business
 * rule): the send job records Meta's id just after Meta answers, so a quick Delivered can come
 * first. Until then the body stays unhandled and its job tries again (1, 2, 4 minutes); after it,
 * the status is for a message not sent by us (Meta's dashboard, say) and is let go.
 */
export const UNKNOWN_STATUS_WAIT_MS = 10 * 60_000;

export class StatusAheadOfSendError extends Error {
  override name = 'StatusAheadOfSendError';
}

/**
 * Stores a body whose signature checked out and whose envelope the route checked; returns its id.
 * Kept exactly as Meta sent it (parsing would drop the fields we do not read yet).
 */
export const receiveWhatsappWebhook = systemService({
  component: 'whatsapp',
  input: z.object({ payload: z.unknown() }),
  run: (tx, { payload }) => storeWhatsappEvent(tx, payload),
});

export interface EventOutcome {
  /** Statuses that moved a message on. */
  updated: number;
  /** Messages sent to us, stored. */
  received: number;
  /** Their ids, for the router (WA-03). */
  receivedIds: string[];
  /** Templates of ours Meta moved on (WA-06). */
  templates: number;
  /** Already handled, or deleted. */
  skipped: boolean;
}

const handle = systemService({
  component: 'whatsapp',
  input: z.object({ eventId: z.guid(), now: z.date() }),
  run: async (tx, { eventId, now }): Promise<EventOutcome> => {
    const event = await whatsappEventRecord(tx, eventId, { lock: true });
    if (!event || event.processedAt) {
      return { updated: 0, received: 0, receivedIds: [], templates: 0, skipped: true };
    }
    const outcome: EventOutcome = {
      updated: 0,
      received: 0,
      receivedIds: [],
      templates: 0,
      skipped: false,
    };
    // The route stored only bodies that passed this schema; one that no longer does is closed.
    const parsed = whatsappWebhookSchema.safeParse(event.payload);
    if (parsed.success) {
      const { updates, messages, templates } = webhookContents(parsed.data);
      let unknown = 0;
      for (const update of updates) {
        if (update.status === 'sent') continue;
        const applied = await applyDeliveryUpdate(tx, update);
        if (applied === 'changed') outcome.updated++;
        if (applied === 'unknown') unknown++;
      }
      // Thrown, so nothing here is kept and the body is handled whole on the next try.
      if (unknown > 0 && now.getTime() - event.receivedAt.getTime() < UNKNOWN_STATUS_WAIT_MS) {
        throw new StatusAheadOfSendError(
          `WhatsApp event ${eventId}: ${String(unknown)} status(es) for a message not recorded yet; trying again.`,
        );
      }
      for (const inbound of messages) {
        const id = await recordInboundMessage(tx, inbound);
        if (id) outcome.receivedIds.push(id);
      }
      outcome.received = outcome.receivedIds.length;
      // A template submitted from another environment, or one of Meta's samples, is not ours.
      for (const template of templates) {
        if ((await applyTemplateUpdate(tx, template)) === 'changed') outcome.templates++;
      }
    }
    await markWhatsappEventProcessed(tx, eventId);
    return outcome;
  },
});

export function handleWhatsappEvent(
  db: Db,
  eventId: string,
  now: Date = new Date(),
): Promise<EventOutcome> {
  return handle(db, { eventId, now });
}
