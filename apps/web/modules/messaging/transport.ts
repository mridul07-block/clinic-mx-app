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

/** A button's value on a template (WA-06), by the button's place on it. */
export type TemplateButtonParameter =
  | { index: number; kind: 'url'; suffix: string }
  | { index: number; kind: 'quick_reply'; payload: string }
  | { index: number; kind: 'flow'; token: string };

export interface TemplateSend {
  to: string;
  template: string;
  language: string;
  /** Body parameters, in the template's order. */
  parameters: string[];
  /**
   * A document header (WA-06): the PDF uploaded to Meta just before (`uploadMedia`), by Meta's
   * media id, never a public link; and the file name the patient sees.
   */
  document?: { id: string; filename: string };
  buttons?: readonly TemplateButtonParameter[];
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

/** An upload to Meta's media store; `waMessageId` here is the media id. */
export type UploadResult = SendResult;

export interface WhatsAppTransport {
  sendTemplate(message: TemplateSend, signal: AbortSignal): Promise<SendResult>;
  sendSession(message: SessionSend, signal: AbortSignal): Promise<SendResult>;
  /** A PDF for a template's document header (WA-06), kept by Meta for the send. */
  uploadMedia(
    file: { bytes: Uint8Array<ArrayBuffer>; filename: string },
    signal: AbortSignal,
  ): Promise<UploadResult>;
}

const isTimeout = (error: unknown) =>
  error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;

function buttonComponent(button: TemplateButtonParameter) {
  const common = { type: 'button', sub_type: button.kind, index: String(button.index) };
  switch (button.kind) {
    case 'url':
      return { ...common, parameters: [{ type: 'text', text: button.suffix }] };
    case 'quick_reply':
      return { ...common, parameters: [{ type: 'payload', payload: button.payload }] };
    case 'flow':
      return { ...common, parameters: [{ type: 'action', action: { flow_token: button.token } }] };
  }
}

/** The request body Meta's Cloud API takes for a template message. */
export function templateBody(message: TemplateSend) {
  const components = [
    ...(message.document
      ? [{ type: 'header', parameters: [{ type: 'document', document: message.document }] }]
      : []),
    ...(message.parameters.length > 0
      ? [
          {
            type: 'body',
            parameters: message.parameters.map((value) => ({ type: 'text', text: value })),
          },
        ]
      : []),
    ...(message.buttons ?? []).map(buttonComponent),
  ];
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    // Meta takes the number without the plus.
    to: message.to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: message.template,
      language: { code: message.language },
      ...(components.length > 0 ? { components } : {}),
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
  const base = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}`;
  const post = (payload: unknown, signal: AbortSignal) =>
    call(
      `${base}/messages`,
      { 'content-type': 'application/json' },
      JSON.stringify(payload),
      signal,
    );
  async function call(
    url: string,
    headers: Record<string, string>,
    content: string | FormData,
    signal: AbortSignal,
  ): Promise<SendResult> {
    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.accessToken}`, ...headers },
        body: content,
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
      id?: unknown;
      messages?: { id?: unknown }[];
      error?: {
        code?: unknown;
        error_subcode?: unknown;
        message?: unknown;
        error_user_title?: unknown;
      };
    };
    // A message's id, or an uploaded file's.
    const id = text(answer.messages?.[0]?.id) ?? text(answer.id);
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
    uploadMedia: ({ bytes, filename }, signal) => {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'application/pdf');
      form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
      return call(`${base}/media`, {}, form, signal);
    },
    sendSession: (message, signal) => post(sessionBody(message), signal),
  };
}
