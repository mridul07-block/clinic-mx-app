import 'server-only';

/**
 * The one way out to WhatsApp (WA-01; TAD section 6): a template message, or a router reply inside
 * the 24 hour window (WA-03: text, or text with reply buttons), through the Cloud API's
 * `/<phone number id>/messages`. It only sends and reads Meta's answer; nothing of the message or
 * the answer goes into an error, and the token is never logged.
 */

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
}

export interface TemplateSend {
  to: string;
  template: string;
  language: string;
  /** Body parameters, in the template's order. */
  parameters: string[];
}

/**
 * A reply inside WhatsApp's 24 hour window: text, with up to 3 reply buttons, or with a button
 * opening a Flow (WA-04).
 */
export interface SessionSend {
  to: string;
  text: string;
  buttons?: readonly { id: string; title: string }[];
  flow?: { id: string; token: string; cta: string; mode: 'draft' | 'published' };
}

export type SendResult =
  | { ok: true; waMessageId: string }
  | {
      ok: false;
      kind: 'network' | 'timeout' | 'http';
      httpStatus?: number;
      /** Meta's error code and title, when it gave them. */
      code?: string;
      title?: string;
    };

export interface WhatsAppTransport {
  sendTemplate(message: TemplateSend, signal: AbortSignal): Promise<SendResult>;
  sendSession(message: SessionSend, signal: AbortSignal): Promise<SendResult>;
}

const isTimeout = (error: unknown) =>
  error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;

/** The request body Meta's Cloud API takes for a template message. */
export function templateBody(message: TemplateSend) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    // Meta takes the number without the plus.
    to: message.to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: message.template,
      language: { code: message.language },
      ...(message.parameters.length > 0
        ? {
            components: [
              {
                type: 'body',
                parameters: message.parameters.map((value) => ({ type: 'text', text: value })),
              },
            ],
          }
        : {}),
    },
  };
}

/** The request body for a router reply: plain text, or an interactive message with buttons. */
export function sessionBody(message: SessionSend) {
  const common = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to.replace(/^\+/, ''),
  };
  if (message.flow) {
    return {
      ...common,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: message.text },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: message.flow.token,
            flow_id: message.flow.id,
            flow_cta: message.flow.cta,
            flow_action: 'data_exchange',
            ...(message.flow.mode === 'draft' ? { mode: 'draft' } : {}),
          },
        },
      },
    };
  }
  if (!message.buttons?.length) {
    return { ...common, type: 'text', text: { preview_url: false, body: message.text } };
  }
  return {
    ...common,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: message.text },
      action: {
        buttons: message.buttons.map((button) => ({
          type: 'reply',
          reply: { id: button.id, title: button.title },
        })),
      },
    },
  };
}

export function cloudApiTransport(
  config: WhatsAppConfig,
  send: typeof fetch = fetch,
): WhatsAppTransport {
  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
  async function post(payload: unknown, signal: AbortSignal): Promise<SendResult> {
    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal,
      });
    } catch (error) {
      return { ok: false, kind: isTimeout(error) ? 'timeout' : 'network' };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      if (signal.aborted || isTimeout(error)) return { ok: false, kind: 'timeout' };
    }
    const answer = (body ?? {}) as {
      messages?: { id?: unknown }[];
      error?: {
        code?: unknown;
        error_subcode?: unknown;
        message?: unknown;
        error_user_title?: unknown;
      };
    };
    const id = text(answer.messages?.[0]?.id);
    if (response.ok && id) return { ok: true, waMessageId: id };
    return {
      ok: false,
      kind: 'http',
      httpStatus: response.status,
      code: text(answer.error?.code),
      // Meta's short title, never the whole message, which can repeat the number.
      title: text(answer.error?.error_user_title) ?? `HTTP ${String(response.status)}`,
    };
  }
  return {
    sendTemplate: (message, signal) => post(templateBody(message), signal),
    sendSession: (message, signal) => post(sessionBody(message), signal),
  };
}
