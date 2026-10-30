import { describe, expect, it } from 'vitest';
import {
  deliveryChange,
  webhookContents,
  whatsappWebhookSchema,
  type DeliveryState,
  type DeliveryUpdate,
} from './whatsapp-webhook';

// WA-02: what Meta's webhook says, and how far a message we sent has got. Generated numbers only.
const body = (value: Record<string, unknown>, field = 'messages') =>
  whatsappWebhookSchema.parse({
    object: 'whatsapp_business_account',
    entry: [{ id: '1103346035769121', changes: [{ field, value }] }],
  });

const status = (overrides: Record<string, unknown> = {}) => ({
  id: 'wamid.OUT1',
  status: 'delivered',
  timestamp: '1793350000',
  recipient_id: '919845012345',
  ...overrides,
});

const message = (overrides: Record<string, unknown>) => ({
  from: '919845012345',
  id: 'wamid.IN1',
  timestamp: '1793350100',
  ...overrides,
});

describe('the webhook body', () => {
  it('takes only WhatsApp Business Account bodies', () => {
    expect(whatsappWebhookSchema.safeParse({ object: 'page', entry: [] }).success).toBe(false);
    expect(whatsappWebhookSchema.safeParse({ object: 'whatsapp_business_account' }).success).toBe(
      false,
    );
  });

  it('reads delivery statuses, with Meta’s code and title on a failure', () => {
    const { updates } = webhookContents(
      body({
        statuses: [
          status(),
          status({
            id: 'wamid.OUT2',
            status: 'failed',
            errors: [{ code: 131026, title: 'Message undeliverable' }],
          }),
        ],
      }),
    );
    expect(updates).toEqual([
      {
        waMessageId: 'wamid.OUT1',
        status: 'delivered',
        at: new Date(1793350000 * 1000),
        errorCode: null,
        errorTitle: null,
      },
      {
        waMessageId: 'wamid.OUT2',
        status: 'failed',
        at: new Date(1793350000 * 1000),
        errorCode: '131026',
        errorTitle: 'Message undeliverable',
      },
    ]);
  });

  it('reads a text, a button reply, a list reply, a Flow completion and anything else', () => {
    const { messages } = webhookContents(
      body({
        messages: [
          message({ type: 'text', text: { body: 'Hi' } }),
          message({
            id: 'wamid.IN2',
            type: 'button',
            button: { text: 'Confirm', payload: 'confirm' },
            context: { from: '15556472996', id: 'wamid.OUT1' },
          }),
          message({
            id: 'wamid.IN3',
            type: 'interactive',
            interactive: { type: 'list_reply', list_reply: { id: 'hsr', title: 'HSR Layout' } },
          }),
          message({
            id: 'wamid.IN4',
            type: 'interactive',
            interactive: {
              type: 'nfm_reply',
              nfm_reply: { name: 'booking', body: 'Sent', response_json: '{"clinic":"hsr"}' },
            },
          }),
          message({ id: 'wamid.IN5', type: 'image', image: { id: 'media1' } }),
        ],
      }),
    );
    expect(
      messages.map(({ kind, body, replyId, replyPayload, contextWaId }) => ({
        kind,
        body,
        replyId,
        replyPayload,
        contextWaId,
      })),
    ).toEqual([
      { kind: 'text', body: 'Hi', replyId: null, replyPayload: null, contextWaId: null },
      {
        kind: 'reply',
        body: 'Confirm',
        replyId: 'confirm',
        replyPayload: null,
        contextWaId: 'wamid.OUT1',
      },
      { kind: 'reply', body: 'HSR Layout', replyId: 'hsr', replyPayload: null, contextWaId: null },
      {
        kind: 'flow',
        body: null,
        replyId: 'booking',
        replyPayload: { clinic: 'hsr' },
        contextWaId: null,
      },
      { kind: 'other', body: null, replyId: null, replyPayload: null, contextWaId: null },
    ]);
    expect(messages[0]?.fromPhone).toBe('+919845012345');
    expect(messages[0]?.at).toEqual(new Date(1793350100 * 1000));
  });

  it('counts what it does not understand, without dropping the rest', () => {
    const contents = webhookContents(
      body({
        statuses: [status({ status: 'deleted' }), status({ timestamp: 'soon' }), status()],
        messages: [message({ from: 'not a number', type: 'text', text: { body: 'x' } })],
      }),
    );
    expect(contents.updates).toHaveLength(1);
    expect(contents.messages).toHaveLength(0);
    expect(contents.ignored).toBe(3);
    expect(webhookContents(body({}, 'account_update')).ignored).toBe(1);
  });

  it('keeps a Flow’s answers only when they are an object', () => {
    const flow = (json: string) =>
      webhookContents(
        body({
          messages: [
            message({
              type: 'interactive',
              interactive: { type: 'nfm_reply', nfm_reply: { response_json: json } },
            }),
          ],
        }),
      ).messages[0];
    expect(flow('not json')?.replyPayload).toBeNull();
    expect(flow('[1]')?.replyPayload).toBeNull();
    expect(flow('{}')?.replyId).toBe('flow');
  });
});

describe('delivery progress', () => {
  const at = new Date('2026-10-30T10:00:00Z');
  const later = new Date('2026-10-30T10:05:00Z');
  const state = (status: DeliveryState['status'], deliveredAt: Date | null = null) => ({
    status,
    deliveredAt,
    readAt: null,
  });
  const update = (s: DeliveryUpdate['status'], when = at): DeliveryUpdate => ({
    waMessageId: 'wamid.OUT1',
    status: s,
    at: when,
    errorCode: s === 'failed' ? '131026' : null,
    errorTitle: s === 'failed' ? 'Message undeliverable' : null,
  });

  it('moves forward: Sent, Delivered, Read', () => {
    expect(deliveryChange(state('sent'), update('delivered'))).toEqual({
      status: 'delivered',
      deliveredAt: at,
    });
    expect(deliveryChange(state('delivered', at), update('read', later))).toEqual({
      status: 'read',
      deliveredAt: at,
      readAt: later,
    });
  });

  it('counts a Read before its Delivered as both', () => {
    expect(deliveryChange(state('sent'), update('read', later))).toEqual({
      status: 'read',
      deliveredAt: later,
      readAt: later,
    });
  });

  it('never moves back, and a repeat changes nothing', () => {
    expect(deliveryChange(state('read', at), update('delivered'))).toBeNull();
    expect(deliveryChange(state('delivered', at), update('delivered'))).toBeNull();
    expect(deliveryChange(state('read', at), update('read'))).toBeNull();
    expect(deliveryChange(state('delivered', at), update('sent'))).toBeNull();
  });

  it('fails a message Meta took but could not deliver, with its reason', () => {
    expect(deliveryChange(state('sent'), update('failed'))).toEqual({
      status: 'failed',
      errorCode: '131026',
      errorTitle: 'Message undeliverable',
    });
    expect(deliveryChange(state('sent'), { ...update('failed'), errorTitle: null })).toMatchObject({
      errorTitle: 'Meta could not deliver it.',
    });
    expect(deliveryChange(state('delivered', at), update('failed'))).toBeNull();
  });

  it('leaves alone a message never sent, or one received', () => {
    for (const s of ['queued', 'skipped', 'failed', 'received'] as const) {
      expect(deliveryChange(state(s), update('delivered'))).toBeNull();
      expect(deliveryChange(state(s), update('read'))).toBeNull();
      expect(deliveryChange(state(s), update('failed'))).toBeNull();
    }
  });
});
