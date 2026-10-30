import { z } from 'zod';
import { messageTemplate, type MessageTemplateKey, type TemplateStatus } from './message-templates';

/**
 * WhatsApp messages (WA-01; TAD section 6, `message`): every message the platform sends is a row
 * first, then a job sends it through the Cloud API, retried by the job queue. Decisions (user,
 * 30 October 2026): staging sends through the Meta test number of the "Clinic Mx Demo VelyxLabs"
 * app; while `whatsapp.test_recipients_only` is on, only numbers on `whatsapp.test_recipients`
 * receive anything and every other message is kept as Skipped; a Super Admin test send uses Meta's
 * `hello_world` sample until WA-06 has the clinic's templates approved.
 */

/** What we send (a template, or a test of Meta's sample); what arrives (WA-02). */
export const outboundKinds = ['template', 'test'] as const;
export const inboundKinds = ['text', 'reply', 'flow', 'other'] as const;
export type InboundKind = (typeof inboundKinds)[number];
export const messageKinds = [...outboundKinds, ...inboundKinds] as const;
export type MessageKind = (typeof messageKinds)[number];

/** What a received message is, as the Recent messages list shows it (never its text). */
export const inboundKindLabels: Record<InboundKind, string> = {
  text: 'Text',
  reply: 'Reply',
  flow: 'Flow',
  other: 'Other',
};

export const messageDirections = ['outbound', 'inbound'] as const;
export type MessageDirection = (typeof messageDirections)[number];

/** Delivered and Read come through the webhook (WA-02), as does Received for an inbound one. */
export const messageStatuses = [
  'queued',
  'sent',
  'failed',
  'skipped',
  'delivered',
  'read',
  'received',
] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const messageStatusLabels: Record<MessageStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Not sent',
  delivered: 'Delivered',
  read: 'Read',
  received: 'Received',
};

/** Meta's sample template, approved on every test number; used only for test sends. */
export const TEST_TEMPLATE = { key: 'hello_world', language: 'en_US' } as const;

/** The language every clinic template is written in (English only, rule 8). */
export const TEMPLATE_LANGUAGE = 'en';

/** A phone number as WhatsApp addresses it: E.164, + and 8 to 15 digits. */
export const whatsappNumberSchema = z
  .string()
  .trim()
  .transform((typed) => typed.replace(/[\s().-]/g, ''))
  .pipe(
    z.string().regex(/^\+[1-9]\d{7,14}$/, {
      error: 'Enter the number with its country code, for example +91 98450 12345.',
    }),
  );

/** The Settings value `whatsapp.test_recipients`: at most 5, as Meta's test number allows. */
export const testRecipientsSchema = z.array(whatsappNumberSchema).max(5);

/** Why a message was not sent, as the Recent messages list shows it. */
export const skipReasons = {
  notOnTestList: 'Not on the WhatsApp test list.',
  notConfigured: 'WhatsApp is not configured on this server.',
} as const;

/** Whether a message may go to this number now: anyone, or only the test list while it is on. */
export function mayReceive(
  to: string,
  rules: { testRecipientsOnly: boolean; testRecipients: readonly string[] },
): boolean {
  return !rules.testRecipientsOnly || rules.testRecipients.includes(to);
}

/** Whether a clinic template may be sent: only once Meta has approved it (WA-06). */
export function templateSendable(key: MessageTemplateKey): boolean {
  return (messageTemplate(key).status as TemplateStatus) === 'approved';
}

/** A number as lists show it: everything but the last 4 digits hidden. */
export function maskNumber(e164: string): string {
  return e164.length <= 4 ? e164 : `${'•'.repeat(Math.min(e164.length - 4, 6))}${e164.slice(-4)}`;
}

/**
 * Whether a failed send should be tried again by the job queue: no answer, a rate limit or a
 * fault on Meta's side. Any other refusal (a wrong number, an unknown template) never succeeds.
 */
export function retryableSendFailure(failure: {
  kind: 'network' | 'timeout' | 'http';
  httpStatus?: number;
}): boolean {
  if (failure.kind !== 'http') return true;
  const status = failure.httpStatus ?? 0;
  return status === 429 || status >= 500;
}

export const sendTestMessageSchema = z.object({ to: whatsappNumberSchema });
