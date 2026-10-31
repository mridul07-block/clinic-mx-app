import 'server-only';
import {
  centreContacts,
  confirmAppointment,
  createFlowSession,
  flowSessionRecord,
  inboundToRoute,
  queueMessage,
  raiseEmergencyTask,
  recordRoute,
  repliedMessage,
  solePatientByPhone,
  type Db,
  type DbOrTransaction,
} from '@clinic-mx/db';
import {
  APPOINTMENT_CHANGED_TEXT,
  CHECK_ANSWER_ALREADY,
  CHECK_ANSWER_THANKS,
  SESSION_REPLY_VERSION,
  TEMPLATE_LANGUAGE,
  appointmentConfirmedText,
  checkAnswerOf,
  contactText,
  documentTime,
  emergencyReplyText,
  flowReplies,
  inboundKinds,
  istDate,
  routeHandlers,
  routeInbound,
  type InboundKind,
  type FlowReply,
  type InboundRoute,
  type RouteReply,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { serverEnv } from '../../lib/env';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { flowDate } from './booking-flow';
import { recordCheckAnswerIn } from './clinic-messages';

/**
 * The conversation router (WA-03; TAD section 6). Each message sent to the clinic's number gets
 * one route and one reply, as `system:whatsapp`: the three button menu, or "Talk to our team"
 * (WA-09), which also stands in for every handler not live yet (user decision, 30 October 2026).
 * The webhook routes a message straight after storing it; the `whatsapp.route` job queued with the
 * message is the fallback. The row is locked and a routed one skipped, so it runs once.
 */

export const WHATSAPP_ROUTE_JOB = 'whatsapp.route';

/**
 * How long a Flow sent now can be used: WhatsApp's 24 hour window, after which no reply that is
 * not a template may go anyway (a technical limit, not a business rule).
 */
const FLOW_SESSION_MS = 24 * 60 * 60 * 1000;

/** Whether a Flow is set up on this server: booking (WA-04) or reschedule (WA-05). */
export function flowReady(reply: FlowReply): boolean {
  const env = serverEnv();
  const id =
    reply === 'booking_flow' ? env.WHATSAPP_BOOKING_FLOW_ID : env.WHATSAPP_RESCHEDULE_FLOW_ID;
  return Boolean(id && env.WHATSAPP_FLOW_PRIVATE_KEY);
}

const isFlowReply = (reply: RouteReply): reply is FlowReply =>
  (flowReplies as readonly string[]).includes(reply);

export interface RouteOutcome {
  route: InboundRoute | null;
  reply: RouteReply | null;
  /** Already routed, or not an inbound message. */
  skipped: boolean;
}

const isInboundKind = (kind: string): kind is InboundKind =>
  (inboundKinds as readonly string[]).includes(kind);

/**
 * Which of our Flows a completed form came from: Meta names every completion `flow`, so the
 * Flow token in its answers finds our session and its kind (`booking` or `reschedule`).
 */
async function completedFlowKind(
  tx: DbOrTransaction,
  answers: Record<string, unknown> | null,
): Promise<string | undefined> {
  const token = z.guid().safeParse(answers?.flow_token);
  return token.success ? (await flowSessionRecord(tx, token.data))?.kind : undefined;
}

/**
 * A tap on a check's reply button (WA-06): recorded as the answer of the link the message we sent
 * stands for, then thanked; one answered already (the desk's QR, an earlier tap) is thanked as
 * such. A tap on a message we cannot find, or one that stands for no link, gets the menu.
 */
async function answerCheck(
  tx: DbOrTransaction,
  inbound: { replyId: string | null; contextWaId: string | null },
): Promise<'menu' | { text: string }> {
  const tapped = checkAnswerOf(inbound.replyId);
  const ours = inbound.contextWaId ? await repliedMessage(tx, inbound.contextWaId) : undefined;
  if (!tapped || !ours?.patientLinkId || ours.templateKey !== tapped.template) return 'menu';
  const outcome = await recordCheckAnswerIn(tx, {
    linkId: ours.patientLinkId,
    template: tapped.template,
    answer: tapped.answer,
  });
  return { text: outcome === 'recorded' ? CHECK_ANSWER_THANKS : CHECK_ANSWER_ALREADY };
}

/**
 * A tap on the day before reminder's Confirm (WA-08; PRD J1.6): the reminder's appointment becomes
 * Confirmed and they are thanked, with its day and time; one confirmed already is thanked the same.
 * One moved, cancelled or started since gets the team's contact details (user decision,
 * 31 October 2026). A tap on a message we cannot match gets the menu.
 */
async function confirmReminder(
  tx: DbOrTransaction,
  inbound: { contextWaId: string | null },
  email: string,
): Promise<'menu' | { text: string }> {
  const ours = inbound.contextWaId ? await repliedMessage(tx, inbound.contextWaId) : undefined;
  if (!ours?.appointmentId || ours.templateKey !== 'day_before_reminder') return 'menu';
  const result = await confirmAppointment(tx, ours.appointmentId, new Date());
  if (result.outcome === 'changed' || !result.startsAt) {
    const centres = await centreContacts(tx, result.centreId);
    return { text: `${APPOINTMENT_CHANGED_TEXT} ${contactText({ centres, email })}` };
  }
  return {
    text: appointmentConfirmedText({
      date: flowDate(istDate(result.startsAt)),
      time: documentTime(result.startsAt),
    }),
  };
}

/**
 * A message with an emergency phrase (WA-10; PRD J1.9): the emergency advice with the clinic's
 * number, never a booking, and an urgent task for the front desk to call back, one open per number
 * (user decision, 31 October 2026).
 */
async function answerEmergency(
  tx: DbOrTransaction,
  message: { id: string; fromPhone: string; waMessageId: string | null },
  owner: { id: string; centreId: string } | undefined,
): Promise<void> {
  const advice = await getSetting('whatsapp.emergency_advice');
  const centres = await centreContacts(tx, owner?.centreId);
  await queueMessage(tx, {
    patientId: owner?.id ?? null,
    toPhone: message.fromPhone,
    kind: 'session',
    templateKey: 'emergency_advice',
    templateVersion: SESSION_REPLY_VERSION,
    language: TEMPLATE_LANGUAGE,
    variables: { text: emergencyReplyText(advice, centres) },
    createdBy: 'system:whatsapp',
    contextWaId: message.waMessageId,
  });
  await raiseEmergencyTask(tx, {
    messageId: message.id,
    phone: message.fromPhone,
    patientId: owner?.id ?? null,
    centreId: owner?.centreId ?? null,
  });
}

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
    const flowKind =
      message.kind === 'flow' ? await completedFlowKind(tx, message.replyPayload) : undefined;
    const chosen = routeInbound(
      { kind: message.kind, body: message.body, replyId: flowKind ?? message.replyId },
      { emergencyPhrases },
    );
    await recordRoute(tx, message.id, chosen, owner?.id ?? null);

    if (chosen === 'emergency') {
      await answerEmergency(tx, { ...message, fromPhone: message.fromPhone }, owner);
      return { route: chosen, reply: 'none', skipped: false };
    }

    if (chosen === 'check_answer' || chosen === 'confirm') {
      const answered =
        chosen === 'check_answer'
          ? await answerCheck(tx, message)
          : await confirmReminder(tx, message, email);
      const answerKey = chosen === 'check_answer' ? 'check_answer' : 'appointment_confirmed';
      await queueMessage(tx, {
        patientId: owner?.id ?? null,
        toPhone: message.fromPhone,
        kind: 'session',
        templateKey: answered === 'menu' ? 'menu' : answerKey,
        templateVersion: SESSION_REPLY_VERSION,
        language: TEMPLATE_LANGUAGE,
        variables: answered === 'menu' ? {} : answered,
        createdBy: 'system:whatsapp',
        contextWaId: message.waMessageId,
      });
      return { route: chosen, reply: answered === 'menu' ? 'menu' : 'none', skipped: false };
    }

    const wanted = routeHandlers[chosen].reply;
    const reply = isFlowReply(wanted) && !flowReady(wanted) ? 'contact' : wanted;
    if (reply === 'none') return { route: chosen, reply, skipped: false };
    let variables: Record<string, string> = {};
    if (reply === 'contact') {
      variables = {
        text: contactText({ centres: await centreContacts(tx, owner?.centreId), email }),
      };
    } else if (isFlowReply(reply)) {
      // From the menu the reschedule form first lists the number's appointments (WA-05).
      const flowToken = await createFlowSession(tx, {
        phone: message.fromPhone,
        kind: reply === 'booking_flow' ? 'booking' : 'reschedule',
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
