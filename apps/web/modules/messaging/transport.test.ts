import { describe, expect, it, vi } from 'vitest';
import { cloudApiTransport, sessionBody, templateBody } from './transport';

vi.mock('server-only', () => ({}));

const config = {
  accessToken: 'fake',
  phoneNumberId: '111',
  graphVersion: 'v25.0',
};
const hello = { to: '+919845012345', template: 'hello_world', language: 'en_US', parameters: [] };
const signal = () => new AbortController().signal;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

// WA-01: the Cloud API call, and nothing of the message or the token in a failure.
describe('cloudApiTransport', () => {
  it('posts the template to the number’s messages endpoint and reads Meta’s id', async () => {
    const send = vi.fn(() => json(200, { messages: [{ id: 'wamid.1' }] }));
    const result = await cloudApiTransport(config, send).sendTemplate(hello, signal());
    expect(result).toEqual({ ok: true, waMessageId: 'wamid.1' });
    expect(send).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/111/messages',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${config.accessToken}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ to: '919845012345', type: 'template' });
  });

  it('puts template variables in the body, in order', () => {
    expect(
      templateBody({ ...hello, template: 'receipt', language: 'en', parameters: ['A', 'B'] })
        .template,
    ).toEqual({
      name: 'receipt',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'A' },
            { type: 'text', text: 'B' },
          ],
        },
      ],
    });
  });

  // WA-06: a PDF header and the buttons' values, by their place on the template.
  it('puts a document header and button values in their components', () => {
    expect(
      templateBody({
        ...hello,
        template: 'consultation_summary_v1',
        language: 'en',
        parameters: ['A'],
        document: { link: 'https://clinic.example/d/1.pdf', filename: 'Summary.pdf' },
        buttons: [
          { index: 0, kind: 'url', suffix: 'token-1' },
          { index: 1, kind: 'quick_reply', payload: 'key.better' },
          { index: 2, kind: 'flow', token: 'flow-token' },
        ],
      }).template.components,
    ).toEqual([
      {
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: { link: 'https://clinic.example/d/1.pdf', filename: 'Summary.pdf' },
          },
        ],
      },
      { type: 'body', parameters: [{ type: 'text', text: 'A' }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'token-1' }],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '1',
        parameters: [{ type: 'payload', payload: 'key.better' }],
      },
      {
        type: 'button',
        sub_type: 'flow',
        index: '2',
        parameters: [{ type: 'action', action: { flow_token: 'flow-token' } }],
      },
    ]);
    expect(templateBody(hello).template).toEqual({
      name: 'hello_world',
      language: { code: 'en_US' },
    });
  });

  // WA-03: the router's replies, inside WhatsApp's 24 hour window.
  it('sends a reply as text, or as text with reply buttons', async () => {
    expect(sessionBody({ to: '+919845012345', text: 'Call 080.' })).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919845012345',
      type: 'text',
      text: { preview_url: false, body: 'Call 080.' },
    });
    expect(
      sessionBody({
        to: '+919845012345',
        text: 'How can we help you today?',
        buttons: [{ id: 'menu.talk', title: 'Talk to our team' }],
      }),
    ).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'How can we help you today?' },
        action: {
          buttons: [{ type: 'reply', reply: { id: 'menu.talk', title: 'Talk to our team' } }],
        },
      },
    });
    const send = vi.fn(() => json(200, { messages: [{ id: 'wamid.2' }] }));
    const result = await cloudApiTransport(config, send).sendSession(
      { to: '+919845012345', text: 'Hi' },
      signal(),
    );
    expect(result).toEqual({ ok: true, waMessageId: 'wamid.2' });
  });

  // WA-04: the booking form, opened from a button, as a draft on the test number.
  it('sends a Flow with its token and button, as a draft until it is published', () => {
    const flow = { id: '1429976172668253', token: 'token-1', cta: 'Book appointment' };
    expect(
      sessionBody({ to: '+919845012345', text: 'Book.', flow: { ...flow, mode: 'draft' } }),
    ).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: 'Book.' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: 'token-1',
            flow_id: '1429976172668253',
            flow_cta: 'Book appointment',
            flow_action: 'data_exchange',
            mode: 'draft',
          },
        },
      },
    });
    const published = sessionBody({
      to: '+919845012345',
      text: 'Book.',
      flow: { ...flow, mode: 'published' },
    });
    expect(JSON.stringify(published)).not.toContain('"mode"');
  });

  it('gives Meta’s code and short title on a refusal, never its message', async () => {
    const send = vi.fn(() =>
      json(400, {
        error: {
          code: 131030,
          message: 'Recipient +919845012345 not in allowed list',
          error_user_title: 'Recipient not allowed',
        },
      }),
    );
    const result = await cloudApiTransport(config, send).sendTemplate(hello, signal());
    expect(result).toEqual({
      ok: false,
      kind: 'http',
      httpStatus: 400,
      code: '131030',
      title: 'Recipient not allowed',
    });
    expect(JSON.stringify(result)).not.toContain('9845012345');
  });

  it('tells a network failure from a timeout', async () => {
    const down = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    expect(await cloudApiTransport(config, down).sendTemplate(hello, signal())).toEqual({
      ok: false,
      kind: 'network',
    });
    const slow = vi.fn(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(await cloudApiTransport(config, slow).sendTemplate(hello, signal())).toEqual({
      ok: false,
      kind: 'timeout',
    });
  });
});
