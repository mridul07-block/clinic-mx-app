import 'server-only';
import {
  centreDirections,
  inboundToRoute,
  messageRecord,
  patientNamesByPhone,
  queueMessage,
  solePatientByPhone,
  sourceQueued,
  type Db,
} from '@clinic-mx/db';
import {
  SESSION_REPLY_VERSION,
  TEMPLATE_LANGUAGE,
  assistantAnswerText,
  type AssistantChoice,
  type RouteReply,
  type SessionReply,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { assistantReply } from '../ai/gateway';
import type { AiTransport } from '../ai/gateway/transport';
import { getSetting } from '../settings/settings';
import { answerEmergency, assistantSourceKey, queueRouteReply } from './router';

/**
 * The WhatsApp assistant for typed messages (WA-11; PRD M3 and section 6, TAD sections 6 and 7;
 * docs/runbooks/whatsapp.md, "Assistant"). The model only chooses (user decision, 31 October
 * 2026): one of the clinic's approved answers, sent word for word with the menu's buttons, or a
 * menu choice (the booking or reschedule form, the team's contact details), or the emergency
 * reply (WA-10); anything else, and whenever the model is unavailable, the menu. It is called
 * outside any transaction; the one answer is then queued under the message's row lock, once.
 */

/** The menu choices the model may make, as the router answers them. */
const actionReplies = {
  book: 'booking_flow',
  reschedule: 'reschedule_flow',
  talk: 'contact',
  none: 'menu',
} as const satisfies Record<string, Exclude<RouteReply, 'none'>>;

export type AssistantOutcome =
  { answered: false } | { answered: true; choice: AssistantChoice['kind']; reply: SessionReply };

const queueAnswer = systemService({
  component: 'whatsapp',
  input: z.object({ messageId: z.guid(), choice: z.custom<AssistantChoice>() }),
  run: async (tx, { messageId, choice }): Promise<AssistantOutcome> => {
    const message = await inboundToRoute(tx, messageId);
    const sourceKey = assistantSourceKey(messageId);
    // Under the row lock: whichever of the webhook and the job comes second answers nothing.
    if (!message?.fromPhone || (await sourceQueued(tx, sourceKey))) return { answered: false };
    const inbound = {
      id: message.id,
      fromPhone: message.fromPhone,
      waMessageId: message.waMessageId,
    };
    const owner = await solePatientByPhone(tx, message.fromPhone);
    if (choice.kind === 'emergency') {
      await answerEmergency(tx, inbound, owner, sourceKey);
      return { answered: true, choice: choice.kind, reply: 'emergency_advice' };
    }
    if (choice.kind === 'faq') {
      await queueMessage(tx, {
        patientId: owner?.id ?? null,
        toPhone: message.fromPhone,
        kind: 'session',
        templateKey: 'assistant_answer',
        templateVersion: SESSION_REPLY_VERSION,
        language: TEMPLATE_LANGUAGE,
        variables: { text: assistantAnswerText(choice.faq.answer, await centreDirections(tx)) },
        createdBy: 'system:whatsapp',
        contextWaId: message.waMessageId,
        sourceKey,
      });
      return { answered: true, choice: choice.kind, reply: 'assistant_answer' };
    }
    const reply = await queueRouteReply(tx, inbound, owner, actionReplies[choice.kind], sourceKey);
    return { answered: true, choice: choice.kind, reply };
  },
});

/**
 * Answers a typed message the router sent to the assistant, once: from the webhook straight after
 * routing, or from the `whatsapp.assistant_reply` job. Safe to repeat.
 */
export async function answerTypedMessage(
  db: Db,
  messageId: string,
  options: { transport?: AiTransport | null } = {},
): Promise<AssistantOutcome> {
  const message = await messageRecord(db, messageId);
  if (
    !message?.fromPhone ||
    message.direction !== 'inbound' ||
    message.route !== 'assistant' ||
    (await sourceQueued(db, assistantSourceKey(messageId)))
  ) {
    return { answered: false };
  }
  const [faqs, names] = await Promise.all([
    getSetting('whatsapp.assistant_faqs'),
    patientNamesByPhone(db, message.fromPhone),
  ]);
  const result = message.body?.trim()
    ? await assistantReply(db, {
        message: message.body,
        faqs,
        forbidden: names,
        transport: options.transport,
      })
    : undefined;
  const choice: AssistantChoice = result?.status === 'ok' ? result.output : { kind: 'none' };
  return queueAnswer(db, { messageId, choice });
}
