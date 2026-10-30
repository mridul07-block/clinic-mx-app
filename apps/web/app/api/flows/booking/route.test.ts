import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webhookSignature } from '../../../../modules/messaging/webhook-signature';
import { POST } from './route';

const limits = vi.hoisted(() => ({
  count: vi.fn(),
  limited: vi.fn(),
  networkKey: (address: string | undefined) => address ?? 'unknown',
}));
vi.mock('../../../../modules/rate-limits/limits', () => limits);
vi.mock('../../../../lib/db', () => ({ appDb: () => ({}) }));
const flow = vi.hoisted(() => ({ bookingFlowStep: vi.fn() }));
vi.mock('../../../../modules/messaging/booking-flow', () => flow);

// WA-04: the booking Flow's data endpoint answers only Meta: signed with the app secret, sealed
// with our public key; it answers sealed, and refuses with the codes Meta acts on.
const secret = 's'.repeat(32);
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function sealed(body: unknown, publicKey = keys.publicKey) {
  const aesKey = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(body), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const raw = JSON.stringify({
    encrypted_flow_data: data.toString('base64'),
    encrypted_aes_key: publicEncrypt(
      { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      aesKey,
    ).toString('base64'),
    initial_vector: iv.toString('base64'),
  });
  return { raw, aesKey, iv };
}

const post = (raw: string, signature = webhookSignature(new TextEncoder().encode(raw), secret)) =>
  POST(
    new Request('http://localhost/api/flows/booking', {
      method: 'POST',
      body: raw,
      headers: { 'x-real-ip': '203.0.113.9', 'x-hub-signature-256': signature },
    }),
  );

async function opened(response: Response, aesKey: Buffer, iv: Buffer): Promise<unknown> {
  const answer = Buffer.from(await response.text(), 'base64');
  const decipher = createDecipheriv(
    'aes-128-gcm',
    aesKey,
    Buffer.from(iv.map((byte) => ~byte & 0xff)),
  );
  decipher.setAuthTag(answer.subarray(answer.length - 16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(answer.subarray(0, answer.length - 16)),
      decipher.final(),
    ]).toString('utf8'),
  );
}

describe('POST /api/flows/booking', () => {
  beforeEach(() => {
    vi.stubEnv('WHATSAPP_APP_SECRET', secret);
    vi.stubEnv('WHATSAPP_FLOW_PRIVATE_KEY', keys.privateKey);
    limits.count.mockReset();
    limits.limited.mockReset().mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
    flow.bookingFlowStep.mockReset();
  });

  it('answers Meta’s health check, sealed as Meta expects', async () => {
    const { raw, aesKey, iv } = sealed({ version: '3.0', action: 'ping' });
    const response = await post(raw);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(await opened(response, aesKey, iv)).toEqual({ data: { status: 'active' } });
    expect(flow.bookingFlowStep).not.toHaveBeenCalled();
  });

  it('hands a screen to the booking Flow and seals its answer', async () => {
    flow.bookingFlowStep.mockResolvedValue({ screen: 'CLINIC_DATE', data: { centres: [] } });
    const { raw, aesKey, iv } = sealed({ version: '3.0', action: 'INIT', flow_token: 'token-1' });
    const response = await post(raw);
    expect(await opened(response, aesKey, iv)).toEqual({
      screen: 'CLINIC_DATE',
      data: { centres: [] },
    });
    expect(flow.bookingFlowStep).toHaveBeenCalledWith(
      {},
      { action: 'INIT', screen: undefined, data: undefined, flow_token: 'token-1' },
    );
  });

  it('acknowledges Meta’s notice of an error it showed', async () => {
    const { raw, aesKey, iv } = sealed({
      version: '3.0',
      action: 'data_exchange',
      flow_token: 'token-1',
      data: { error: 'invalid-screen', error_message: 'Something went wrong' },
    });
    expect(await opened(await post(raw), aesKey, iv)).toEqual({ data: { acknowledged: true } });
    expect(flow.bookingFlowStep).not.toHaveBeenCalled();
  });

  it('refuses a wrong signature (432), counting it, and opens nothing', async () => {
    const { raw } = sealed({ action: 'ping' });
    expect((await post(raw, 'sha256=' + '0'.repeat(64))).status).toBe(432);
    expect(limits.count).toHaveBeenCalledWith('webhook_failures_per_network', '203.0.113.9');
  });

  it('answers 421 when it cannot open the request, so Meta fetches the key again', async () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const { raw } = sealed({ action: 'ping' }, other.publicKey);
    expect((await post(raw)).status).toBe(421);
  });

  it('answers 427 for a Flow token it does not know', async () => {
    flow.bookingFlowStep.mockResolvedValue({ unknownToken: true });
    const { raw } = sealed({ action: 'INIT', flow_token: 'gone' });
    expect((await post(raw)).status).toBe(427);
  });

  it('refuses everything while the key or the app secret is not set, and over the limit', async () => {
    const { raw } = sealed({ action: 'ping' });
    vi.stubEnv('WHATSAPP_FLOW_PRIVATE_KEY', '');
    expect((await post(raw)).status).toBe(503);
    vi.stubEnv('WHATSAPP_FLOW_PRIVATE_KEY', keys.privateKey);
    limits.limited.mockResolvedValue({ limited: true, retryAfterSeconds: 30 });
    expect((await post(raw)).status).toBe(429);
  });
});
