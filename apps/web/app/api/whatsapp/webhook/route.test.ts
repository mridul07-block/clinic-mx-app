import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webhookSignature } from '../../../../modules/messaging/webhook-signature';
import { GET, POST } from './route';

const limits = vi.hoisted(() => ({
  count: vi.fn(),
  limited: vi.fn(),
  networkKey: (address: string | undefined) => address ?? 'unknown',
}));
vi.mock('../../../../modules/rate-limits/limits', () => limits);
vi.mock('../../../../lib/db', () => ({ appDb: () => ({}) }));
const webhook = vi.hoisted(() => ({
  receiveWhatsappWebhook: vi.fn(),
  handleWhatsappEvent: vi.fn(),
}));
vi.mock('../../../../modules/messaging/webhook', () => webhook);
const router = vi.hoisted(() => ({ routeInboundMessage: vi.fn() }));
vi.mock('../../../../modules/messaging/router', () => router);
const later = vi.hoisted(() => ({ tasks: [] as (() => Promise<void>)[] }));
vi.mock('next/server', () => ({
  after: (task: () => Promise<void>) => later.tasks.push(task),
}));

// Stand-ins of the lengths the environment needs, built so they never read as keys.
const secret = 's'.repeat(32);
const verifyToken = 'v'.repeat(24);
const address = '203.0.113.9';
const eventId = '00000000-0000-4000-8000-000000000501';

const statusBody = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '1103346035769121',
      changes: [
        {
          field: 'messages',
          value: { statuses: [{ id: 'wamid.OUT1', status: 'read', timestamp: '1793350000' }] },
        },
      ],
    },
  ],
});

const sign = (body: string) => webhookSignature(new TextEncoder().encode(body), secret);

const post = (body: string, signature: string | null, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/whatsapp/webhook', {
      method: 'POST',
      body,
      headers: {
        'x-real-ip': address,
        ...(signature === null ? {} : { 'x-hub-signature-256': signature }),
        ...headers,
      },
    }),
  );

const subscribe = (query: string) =>
  GET(
    new Request(`http://localhost/api/whatsapp/webhook?${query}`, {
      headers: { 'x-real-ip': address },
    }),
  );

// WA-02: Meta's webhook is taken only with the app secret's signature, answered at once, queued.
describe('POST /api/whatsapp/webhook', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_APP_SECRET', secret);
    limits.count.mockReset();
    limits.limited.mockReset();
    limits.limited.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
    webhook.receiveWhatsappWebhook.mockReset();
    webhook.receiveWhatsappWebhook.mockResolvedValue(eventId);
    webhook.handleWhatsappEvent.mockReset();
    webhook.handleWhatsappEvent.mockResolvedValue({
      updated: 1,
      received: 0,
      receivedIds: [],
      skipped: false,
    });
    router.routeInboundMessage.mockReset();
    later.tasks = [];
  });

  it('stores a signed body as it came, answers 200, then handles it straight after', async () => {
    const response = await post(statusBody, sign(statusBody));
    expect(response.status).toBe(200);
    expect(webhook.receiveWhatsappWebhook).toHaveBeenCalledWith(
      {},
      { payload: JSON.parse(statusBody) as unknown },
    );
    expect(webhook.handleWhatsappEvent).not.toHaveBeenCalled();
    expect(later.tasks).toHaveLength(1);
    await later.tasks[0]?.();
    expect(webhook.handleWhatsappEvent).toHaveBeenCalledWith({}, eventId);
    expect(router.routeInboundMessage).not.toHaveBeenCalled();
    expect(limits.count).not.toHaveBeenCalled();
  });

  it('routes each message sent to us straight after storing it (WA-03)', async () => {
    webhook.handleWhatsappEvent.mockResolvedValue({
      updated: 0,
      received: 2,
      receivedIds: ['message-1', 'message-2'],
      skipped: false,
    });
    expect((await post(statusBody, sign(statusBody))).status).toBe(200);
    await later.tasks[0]?.();
    expect(router.routeInboundMessage.mock.calls).toEqual([
      [{}, 'message-1'],
      [{}, 'message-2'],
    ]);
  });

  it('leaves a failed handling to the job, still answering 200', async () => {
    webhook.handleWhatsappEvent.mockRejectedValue(new Error('database busy'));
    expect((await post(statusBody, sign(statusBody))).status).toBe(200);
    await expect(later.tasks[0]?.()).resolves.toBeUndefined();
  });

  it('refuses a wrong, missing or other body’s signature, storing nothing, counting each', async () => {
    const otherBody = sign('{}');
    const wrongSecret = webhookSignature(new TextEncoder().encode(statusBody), 'w'.repeat(32));
    for (const signature of [otherBody, wrongSecret, null, 'sha1=abc']) {
      expect((await post(statusBody, signature)).status).toBe(401);
    }
    expect(webhook.receiveWhatsappWebhook).not.toHaveBeenCalled();
    expect(limits.count).toHaveBeenCalledTimes(4);
    expect(limits.count).toHaveBeenCalledWith('webhook_failures_per_network', address);
  });

  it('answers 429 over the limit before checking anything', async () => {
    limits.limited.mockResolvedValue({ limited: true, retryAfterSeconds: 30 });
    const response = await post(statusBody, sign(statusBody));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(webhook.receiveWhatsappWebhook).not.toHaveBeenCalled();
  });

  it('refuses everything while the app secret is not set', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', '');
    expect((await post(statusBody, sign(statusBody))).status).toBe(503);
    expect(webhook.receiveWhatsappWebhook).not.toHaveBeenCalled();
  });

  it('refuses a body larger than Meta ever sends', async () => {
    const big = 'x'.repeat(1_000_001);
    expect((await post(big, sign(big))).status).toBe(413);
    expect((await post('{}', sign('{}'), { 'content-length': '2000000' })).status).toBe(413);
    expect(webhook.receiveWhatsappWebhook).not.toHaveBeenCalled();
  });

  it('keeps nothing of a signed body that is not about WhatsApp messages', async () => {
    const page = JSON.stringify({ object: 'page', entry: [] });
    const response = await post(page, sign(page));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: true });
    expect((await post('not json', sign('not json'))).status).toBe(400);
    expect(webhook.receiveWhatsappWebhook).not.toHaveBeenCalled();
  });
});

describe('GET /api/whatsapp/webhook (Meta’s subscribe check)', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', verifyToken);
    limits.count.mockReset();
    limits.limited.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
  });

  it('repeats the challenge for our verify token', async () => {
    const response = await subscribe(
      `hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=1158201444`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('1158201444');
    expect(limits.count).not.toHaveBeenCalled();
  });

  it('refuses another token, another mode, or any while ours is not set, counting each', async () => {
    const wrong = await subscribe('hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1');
    expect(wrong.status).toBe(403);
    const mode = await subscribe(`hub.mode=other&hub.verify_token=${verifyToken}&hub.challenge=1`);
    expect(mode.status).toBe(403);
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '');
    const unset = await subscribe('hub.mode=subscribe&hub.verify_token=&hub.challenge=1');
    expect(unset.status).toBe(403);
    expect(limits.count).toHaveBeenCalledTimes(3);
  });
});
