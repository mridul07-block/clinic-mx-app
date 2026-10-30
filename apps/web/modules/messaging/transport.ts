import 'server-only';

/**
 * The one way out to WhatsApp (WA-01; TAD section 6): a template message through the Cloud API's
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

export function cloudApiTransport(
  config: WhatsAppConfig,
  send: typeof fetch = fetch,
): WhatsAppTransport {
  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
  return {
    async sendTemplate(message, signal) {
      let response: Response;
      try {
        response = await send(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(templateBody(message)),
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
    },
  };
}
