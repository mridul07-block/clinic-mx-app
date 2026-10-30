import { z } from 'zod';
import type { TemplateApprovalStatus } from './message-templates';
import type { InboundKind, MessageStatus } from './messaging';

/**
 * What Meta's WhatsApp webhook tells us (WA-02; TAD section 6): how the messages we sent are
 * getting on (Delivered, Read, or Failed after Meta took them) and the messages patients send.
 * The route checks the signature and stores the body as it came; the `whatsapp.event` job reads it
 * through these. One odd item never hides the others: each is checked on its own.
 */

/** The envelope Meta posts for a WhatsApp Business Account. */
export const whatsappWebhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z
            .object({
              statuses: z.array(z.unknown()).optional(),
              messages: z.array(z.unknown()).optional(),
            })
            // A template update's fields sit on the value itself (WA-06).
            .loose(),
        }),
      ),
    }),
  ),
});
export type WhatsappWebhook = z.infer<typeof whatsappWebhookSchema>;

const unixSeconds = z.string().regex(/^\d{1,12}$/);

const metaStatus = z.object({
  id: z.string().min(1),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: unixSeconds,
  errors: z
    .array(z.object({ code: z.number().optional(), title: z.string().optional() }))
    .optional(),
});

const metaMessage = z.object({
  id: z.string().min(1),
  /** Meta gives the number without the +. */
  from: z.string().regex(/^[1-9]\d{7,14}$/),
  timestamp: unixSeconds,
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  /** A quick reply button on a template. */
  button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      /** A Flow completion; its answers come as a JSON string. */
      nfm_reply: z.object({ name: z.string().optional(), response_json: z.string() }).optional(),
    })
    .optional(),
  context: z.object({ id: z.string() }).optional(),
});

/** A delivery status for a message we sent. */
export interface DeliveryUpdate {
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
  errorCode: string | null;
  errorTitle: string | null;
}

/** A message a patient (or anyone) sent to the clinic's number. */
export interface InboundMessage {
  waMessageId: string;
  /** E.164. */
  fromPhone: string;
  at: Date;
  kind: InboundKind;
  /** The text, or the title of the button or list row tapped; none for a Flow or other kinds. */
  body: string | null;
  /** The button or list row id, or the Flow's name. */
  replyId: string | null;
  /** A Flow's answers. */
  replyPayload: Record<string, unknown> | null;
  /** The message of ours it replies to. */
  contextWaId: string | null;
}

/**
 * Meta moved one of our templates on (WA-06): its verdict (`message_template_status_update`) or
 * its category (`template_category_update`).
 */
export interface TemplateUpdate {
  metaId: string;
  status?: TemplateApprovalStatus;
  category?: string;
  /** Meta's reason; none when it gives "NONE". */
  reason: string | null;
}

export interface WebhookContents {
  updates: DeliveryUpdate[];
  messages: InboundMessage[];
  templates: TemplateUpdate[];
  /** Items not understood (another status, a malformed entry); counted, never stored. */
  ignored: number;
}

const at = (seconds: string) => new Date(Number(seconds) * 1000);

/**
 * Meta's word for a template's state, from the webhook's event or the template list's status, as
 * ours; none for one that does not change whether it may be sent (Flagged, a limit reached).
 */
export function templateApprovalOf(meta: string): TemplateApprovalStatus | null {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
    case 'REINSTATED':
      return 'approved';
    case 'PENDING':
    case 'IN_APPEAL':
    case 'APPEAL_REQUESTED':
      return 'pending';
    case 'REJECTED':
      return 'rejected';
    case 'PAUSED':
      return 'paused';
    case 'DISABLED':
    case 'PENDING_DELETION':
    case 'DELETED':
    case 'ARCHIVED':
      return 'disabled';
    default:
      return null;
  }
}

const metaTemplateId = z
  .union([z.string().regex(/^\d+$/), z.int().nonnegative()])
  .transform(String);
const metaReason = (reason: string | null | undefined) =>
  reason && reason.toUpperCase() !== 'NONE' ? reason : null;

const templateStatusUpdate = z.object({
  event: z.string(),
  message_template_id: metaTemplateId,
  reason: z.string().nullish(),
});

const templateCategoryUpdate = z.object({
  message_template_id: metaTemplateId,
  new_category: z.string().optional(),
  correct_category: z.string().optional(),
});

function templateUpdate(field: string, value: unknown): TemplateUpdate | null {
  if (field === 'message_template_status_update') {
    const parsed = templateStatusUpdate.safeParse(value);
    const status = parsed.success ? templateApprovalOf(parsed.data.event) : null;
    return parsed.success && status
      ? { metaId: parsed.data.message_template_id, status, reason: metaReason(parsed.data.reason) }
      : null;
  }
  const parsed = templateCategoryUpdate.safeParse(value);
  const category = parsed.success
    ? (parsed.data.new_category ?? parsed.data.correct_category)
    : undefined;
  return parsed.success && category
    ? {
        metaId: parsed.data.message_template_id,
        category,
        reason: `Meta moved it to the ${category.toLowerCase()} category.`,
      }
    : null;
}

const templateFields = new Set(['message_template_status_update', 'template_category_update']);

function flowAnswers(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function inbound(message: z.infer<typeof metaMessage>): InboundMessage {
  const common = {
    waMessageId: message.id,
    fromPhone: `+${message.from}`,
    at: at(message.timestamp),
    contextWaId: message.context?.id ?? null,
  };
  const none = { body: null, replyId: null, replyPayload: null };
  const choice = message.interactive?.button_reply ?? message.interactive?.list_reply;
  if (message.type === 'text' && message.text) {
    return { ...common, ...none, kind: 'text', body: message.text.body };
  }
  if (message.type === 'button' && message.button) {
    const { text, payload } = message.button;
    return { ...common, ...none, kind: 'reply', body: text, replyId: payload ?? text };
  }
  if (message.type === 'interactive' && choice) {
    return { ...common, ...none, kind: 'reply', body: choice.title, replyId: choice.id };
  }
  const flow = message.interactive?.nfm_reply;
  if (message.type === 'interactive' && flow) {
    return {
      ...common,
      ...none,
      kind: 'flow',
      replyId: flow.name ?? 'flow',
      replyPayload: flowAnswers(flow.response_json),
    };
  }
  return { ...common, ...none, kind: 'other' };
}

/**
 * The statuses, messages and template updates in a webhook body Meta signed; other fields are
 * ignored.
 */
export function webhookContents(body: WhatsappWebhook): WebhookContents {
  const contents: WebhookContents = { updates: [], messages: [], templates: [], ignored: 0 };
  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (templateFields.has(change.field)) {
        const update = templateUpdate(change.field, change.value);
        if (update) contents.templates.push(update);
        else contents.ignored++;
        continue;
      }
      if (change.field !== 'messages') {
        contents.ignored++;
        continue;
      }
      for (const item of change.value.statuses ?? []) {
        const status = metaStatus.safeParse(item);
        if (!status.success) {
          contents.ignored++;
          continue;
        }
        const error = status.data.errors?.[0];
        contents.updates.push({
          waMessageId: status.data.id,
          status: status.data.status,
          at: at(status.data.timestamp),
          errorCode: error?.code === undefined ? null : String(error.code),
          errorTitle: error?.title ?? null,
        });
      }
      for (const item of change.value.messages ?? []) {
        const message = metaMessage.safeParse(item);
        if (message.success) contents.messages.push(inbound(message.data));
        else contents.ignored++;
      }
    }
  }
  return contents;
}

export interface DeliveryState {
  status: MessageStatus;
  deliveredAt: Date | null;
  readAt: Date | null;
}

export type DeliveryChange =
  | { status: 'delivered'; deliveredAt: Date }
  | { status: 'read'; deliveredAt: Date; readAt: Date }
  | { status: 'failed'; errorCode: string | null; errorTitle: string };

/**
 * What a delivery status changes on a message we sent: it only moves forward (Sent, Delivered,
 * Read). Meta may send them late, twice or out of order; a Read before its Delivered counts as
 * both. Failed counts only straight after Sent (Meta took it, then could not deliver it). A
 * message never sent (Queued, Not sent) or received is left alone.
 */
export function deliveryChange(
  current: DeliveryState,
  update: DeliveryUpdate,
): DeliveryChange | null {
  switch (update.status) {
    case 'sent':
      return null;
    case 'delivered':
      return current.status === 'sent' ? { status: 'delivered', deliveredAt: update.at } : null;
    case 'read':
      return current.status === 'sent' || current.status === 'delivered'
        ? { status: 'read', deliveredAt: current.deliveredAt ?? update.at, readAt: update.at }
        : null;
    case 'failed':
      return current.status === 'sent'
        ? {
            status: 'failed',
            errorCode: update.errorCode,
            errorTitle: update.errorTitle ?? 'Meta could not deliver it.',
          }
        : null;
  }
}
