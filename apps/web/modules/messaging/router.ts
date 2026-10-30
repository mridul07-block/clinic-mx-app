import 'server-only';
import {
  centreContacts,
  createFlowSession,
  inboundToRoute,
  queueMessage,
  recordRoute,
  solePatientByPhone,
  type Db,
} from '@clinic-mx/db';
import {
  SESSION_REPLY_VERSION,
  TEMPLATE_LANGUAGE,
  contactText,
  inboundKinds,
  routeHandlers,
  routeInbound,
  type InboundKind,
  type InboundRoute,
  type RouteReply,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { serverEnv } from '../../lib/env';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * The conversation router (WA-03; TAD section 6). Each message sent to the clinic's number gets
 * one route and one reply, as `system:whatsapp`: the three button menu, or "Talk to our team"
 * (WA-09), which also stands in for every handler not live yet (user decision, 30 October 2026).
 * The webhook routes a message straight after storing it; the `whatsapp.route` job queued with the
 * message is the fallback. The row is locked and a routed one skipped, so it runs once.
 */

export const WHATSAPP_ROUTE_JOB = 'whatsapp.route';

/**
 * How long a booking Flow sent now can be used: WhatsApp's 24 hour window, after which no reply
 * that is not a template may go anyway (a technical limit, not a business rule).
 */
const FLOW_SESSION_MS = 24 * 60 * 60 * 1000;

/** Whether the booking Flow is set up on this server (WA-04). */
function bookingFlowReady(): boolean {
  const env = serverEnv();
  return Boolean(env.WHATSAPP_BOOKING_FLOW_ID && env.WHATSAPP_FLOW_PRIVATE_KEY);
}

export interface RouteOutcome {
  route: InboundRoute | null;
  reply: RouteReply | null;
  /** Already routed, or not an inbound message. */
  skipped: boolean;
}

const isInboundKind = (kind: string): kind is InboundKind =>
  (inboundKinds as readonly string[]).includes(kind);

const route = systemService({
  component: 'whatsapp',
  input: z.object({ messageId: z.guid() }),
  run: async (tx, { messageId }): Promise<RouteOutcome> => {
    const message = await inboundToRoute(tx, messageId);
    if (!message?.fromPhone || message.route || !isInboundKind(message.kind)) {
      return { route: null, reply: null, skipped: true };
    }
    const [emergencyPhrases, email, owner] = await Promise.all([
      getSetting('whatsapp.emergency_phrases'),
      getSetting('whatsapp.front_desk_email'),
      solePatientByPhone(tx, message.fromPhone),
    ]);
    const chosen = routeInbound(
      { kind: message.kind, body: message.body, replyId: message.replyId },
      { emergencyPhrases },
    );
    await recordRoute(tx, message.id, chosen, owner?.id ?? null);

    const wanted = routeHandlers[chosen].reply;
    const reply = wanted === 'booking_flow' && !bookingFlowReady() ? 'contact' : wanted;
    if (reply === 'none') return { route: chosen, reply, skipped: false };
    let variables: Record<string, string> = {};
    if (reply === 'contact') {
      variables = {
        text: contactText({ centres: await centreContacts(tx, owner?.centreId), email }),
      };
    } else if (reply === 'booking_flow') {
      const flowToken = await createFlowSession(tx, {
        phone: message.fromPhone,
        kind: 'booking',
        expiresAt: new Date(Date.now() + FLOW_SESSION_MS),
      });
      variables = { flowToken };
    }
    await queueMessage(tx, {
      patientId: owner?.id ?? null,
      toPhone: message.fromPhone,
      kind: 'session',
      templateKey: reply,
      templateVersion: SESSION_REPLY_VERSION,
      language: TEMPLATE_LANGUAGE,
      variables,
      createdBy: 'system:whatsapp',
      contextWaId: message.waMessageId,
    });
    return { route: chosen, reply, skipped: false };
  },
});

export function routeInboundMessage(db: Db, messageId: string): Promise<RouteOutcome> {
  return route(db, { messageId });
}
