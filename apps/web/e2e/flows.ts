import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { TEST_WHATSAPP_APP_SECRET } from './whatsapp';

// The booking Flow's data endpoint for end to end tests (WA-04): tests seal each screen as Meta
// does, with the public half of a key pair made for this run. The config makes the pair once in
// the main process and keeps it in the environment, which the workers and the server inherit;
// it never leaves the machine and is never a deployment's.

export const TEST_BOOKING_FLOW_ID = '1000000000000004';
export const TEST_RESCHEDULE_FLOW_ID = '1000000000000005';

/** Which Flow's endpoint a request goes to (WA-04, WA-05). */
export type FlowPath = 'booking' | 'reschedule';

export function testFlowPrivateKey(): string {
  process.env.E2E_FLOW_PRIVATE_KEY ??= Buffer.from(
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey,
  ).toString('base64');
  return process.env.E2E_FLOW_PRIVATE_KEY;
}

function publicKey() {
  return createPublicKey(createPrivateKey(Buffer.from(testFlowPrivateKey(), 'base64').toString()));
}

export interface FlowAnswer {
  status: number;
  screen?: string;
  data?: Record<string, unknown>;
}

/** One request as Meta sends it: sealed with our public key, signed with the app secret. */
export async function flowRequest(
  request: APIRequestContext,
  body: Record<string, unknown>,
  flow: FlowPath = 'booking',
): Promise<FlowAnswer> {
  const aesKey = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv);
  const sealed = Buffer.concat([
    cipher.update(JSON.stringify({ version: '3.0', ...body }), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const raw = JSON.stringify({
    encrypted_flow_data: sealed.toString('base64'),
    encrypted_aes_key: publicEncrypt(
      { key: publicKey(), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      aesKey,
    ).toString('base64'),
    initial_vector: iv.toString('base64'),
  });
  const response = await request.post(`/api/flows/${flow}`, {
    data: raw,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', TEST_WHATSAPP_APP_SECRET).update(raw).digest('hex')}`,
    },
  });
  if (response.status() !== 200) return { status: response.status() };
  expect(response.headers()['content-type']).toContain('text/plain');
  const answer = Buffer.from(await response.text(), 'base64');
  const decipher = createDecipheriv(
    'aes-128-gcm',
    aesKey,
    Buffer.from(iv.map((byte) => ~byte & 0xff)),
  );
  decipher.setAuthTag(answer.subarray(answer.length - 16));
  const plain = Buffer.concat([
    decipher.update(answer.subarray(0, answer.length - 16)),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plain.toString('utf8')) as {
    screen?: string;
    data?: Record<string, unknown>;
  };
  return { status: 200, ...parsed };
}

/** A screen submitted in the booking Flow, or the reschedule Flow. */
export const flowStep = (
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  flow: FlowPath = 'booking',
) => flowRequest(request, { action: 'data_exchange', flow_token: token, data }, flow);

export const items = (answer: FlowAnswer, key: string) =>
  (answer.data?.[key] ?? []) as { id: string; title: string; description?: string }[];
