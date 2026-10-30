import 'server-only';
import {
  MAX_JOB_ATTEMPTS,
  lastInboundAt,
  messageRecord,
  recordMessageOutcome,
  type Db,
  type Message,
  type MessageOutcome,
} from '@clinic-mx/db';
import {
  BOOKING_FLOW_CTA,
  BOOKING_FLOW_TEXT,
  MENU_BUTTONS,
  MENU_TEXT,
  SESSION_WINDOW_HOURS,
  TEST_TEMPLATE,
  mayReceive,
  messageTemplates,
  retryableSendFailure,
  skipReasons,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { serverEnv } from '../../lib/env';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import {
  cloudApiTransport,
  type SendResult,
  type SessionSend,
  type WhatsAppTransport,
} from './transport';

/**
 * Sends one queued WhatsApp message (WA-01), as the `whatsapp.send` job queued with it. Only a
 * message still Queued is touched, so a job that runs again changes nothing. A router reply (WA-03)
 * goes only within 24 hours of their last message to us, else it is Not sent. A clinic message to
 * a number off the test list while it is on, or any message with WhatsApp not configured on this
 * server (local and CI), is kept as Not sent. A failure Meta may get over (no answer, a rate limit, a fault on its side) is thrown,
 * so the job queue tries again with its backoff; at the last attempt, and on any other refusal,
 * the message is Failed with Meta's code and title.
 */

export const WHATSAPP_SEND_JOB = 'whatsapp.send';

/** How long one call to the Cloud API may take (a technical limit, not a business rule). */
const SEND_TIMEOUT_MS = 10_000;

/** Records a send's outcome as `system:whatsapp`; only a message still Queued changes. */
const recordOutcome = systemService({
  component: 'whatsapp',
  input: z.object({ messageId: z.guid(), outcome: z.custom<MessageOutcome>() }),
  run: (tx, { messageId, outcome }) => recordMessageOutcome(tx, messageId, outcome),
});

export class RetrySendError extends Error {
  override name = 'RetrySendError';
}

/**
 * A reply's content (WA-03): the menu with its buttons, the booking Flow (WA-04; undefined where
 * the Flow is not set up on this server), or the text stored when it was queued.
 */
function sessionContent(message: Message): Omit<SessionSend, 'to'> | undefined {
  if (message.templateKey === 'menu') return { text: MENU_TEXT, buttons: MENU_BUTTONS };
  if (message.templateKey === 'booking_flow') {
    const env = serverEnv();
    const token = message.variables.flowToken;
    if (!env.WHATSAPP_BOOKING_FLOW_ID || !token) return undefined;
    return {
      text: BOOKING_FLOW_TEXT,
      flow: {
        id: env.WHATSAPP_BOOKING_FLOW_ID,
        token,
        cta: BOOKING_FLOW_CTA,
        mode: env.WHATSAPP_FLOW_MODE,
      },
    };
  }
  const text = message.variables.text;
  if (!text) throw new Error(`Reply ${message.id} has no text`);
  return { text };
}

/** Whether they wrote to us within WhatsApp's window, so a reply that is not a template may go. */
async function windowOpen(db: Db, phone: string, now = Date.now()): Promise<boolean> {
  const last = await lastInboundAt(db, phone);
  return last !== null && now - last.getTime() < SESSION_WINDOW_HOURS * 60 * 60 * 1000;
}

/** The template's body parameters in its registry order; none for Meta's test sample. */
function parametersOf(message: Message): string[] {
  if (message.kind === 'test') return [];
  const template = messageTemplates.find((entry) => entry.key === message.templateKey);
  if (!template) throw new Error(`No message template ${message.templateKey}`);
  return template.variables.map((variable) => message.variables[variable.name] ?? '');
}

function configuredTransport(): WhatsAppTransport | undefined {
  const env = serverEnv();
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return undefined;
  return cloudApiTransport({
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    graphVersion: env.WHATSAPP_GRAPH_VERSION,
  });
}

export async function sendQueuedMessage(
  db: Db,
  messageId: string,
  {
    attempt,
    transport = configuredTransport(),
  }: { attempt: number; transport?: WhatsAppTransport },
): Promise<void> {
  const message = await messageRecord(db, messageId);
  if (message?.status !== 'queued') return;
  // Only outbound messages are queued, and they have these (check `message_outbound`).
  const { toPhone, templateKey, language } = message;
  if (!toPhone || !templateKey || !language) return;
  const record = (outcome: MessageOutcome) => recordOutcome(db, { messageId: message.id, outcome });

  const [testRecipientsOnly, testRecipients] = await Promise.all([
    getSetting('whatsapp.test_recipients_only'),
    getSetting('whatsapp.test_recipients'),
  ]);
  // A test send was checked against the list when queued (sendTestMessageService); this server's
  // settings may be up to a minute older than that check (docs/runbooks/settings.md).
  if (message.kind !== 'test' && !mayReceive(toPhone, { testRecipientsOnly, testRecipients })) {
    await record({
      status: 'skipped',
      errorCode: 'not_on_test_list',
      errorTitle: skipReasons.notOnTestList,
    });
    return;
  }
  if (message.kind === 'session' && !(await windowOpen(db, toPhone))) {
    await record({
      status: 'skipped',
      errorCode: 'window_closed',
      errorTitle: skipReasons.windowClosed,
    });
    return;
  }
  const session = message.kind === 'session' ? sessionContent(message) : undefined;
  if (!transport || (message.kind === 'session' && !session)) {
    await record({
      status: 'skipped',
      errorCode: 'not_configured',
      errorTitle: skipReasons.notConfigured,
    });
    return;
  }

  const signal = AbortSignal.timeout(SEND_TIMEOUT_MS);
  const result: SendResult =
    message.kind === 'session'
      ? await transport.sendSession({ to: toPhone, ...(session ?? { text: '' }) }, signal)
      : await transport.sendTemplate(
          {
            to: toPhone,
            template: message.kind === 'test' ? TEST_TEMPLATE.key : templateKey,
            language,
            parameters: parametersOf(message),
          },
          signal,
        );
  if (result.ok) {
    await record({ status: 'sent', waMessageId: result.waMessageId });
    return;
  }
  const errorCode = result.code ?? result.kind;
  const errorTitle =
    result.title ?? (result.kind === 'timeout' ? 'No answer in time' : 'Could not reach WhatsApp');
  if (retryableSendFailure(result) && attempt < MAX_JOB_ATTEMPTS) {
    await record({ status: 'queued', errorCode, errorTitle });
    throw new RetrySendError(
      `WhatsApp did not take message ${message.id} (${errorCode}); trying again.`,
    );
  }
  await record({ status: 'failed', errorCode, errorTitle });
}
