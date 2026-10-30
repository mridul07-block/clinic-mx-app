import {
  constants,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FlowDecryptError,
  decryptFlowRequest,
  encryptFlowResponse,
  flowPrivateKey,
} from './flow-crypto';

// WA-04: Meta's Flow encryption, both ways, with a key pair made for the test.
const pair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

/** What Meta sends: a fresh AES key wrapped with our public key, the body sealed with it. */
function asMeta(body: unknown, publicKey: string) {
  const aesKey = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv);
  const sealed = Buffer.concat([
    cipher.update(JSON.stringify(body), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    aesKey,
    iv,
    request: {
      encrypted_flow_data: sealed.toString('base64'),
      encrypted_aes_key: publicEncrypt(
        { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        aesKey,
      ).toString('base64'),
      initial_vector: iv.toString('base64'),
    },
  };
}

describe('Flow encryption', () => {
  const keys = pair();
  const privateKey = flowPrivateKey(keys.privateKey);

  it('opens what Meta sends and seals the answer as Meta expects', () => {
    const body = { version: '3.0', action: 'ping' };
    const { request, aesKey, iv } = asMeta(body, keys.publicKey);
    const opened = decryptFlowRequest(request, privateKey);
    expect(opened.body).toEqual(body);
    expect(opened.aesKey).toEqual(aesKey);

    const answer = encryptFlowResponse({ data: { status: 'active' } }, opened.aesKey, opened.iv);
    const sealed = Buffer.from(answer, 'base64');
    const flipped = Buffer.from(iv.map((byte) => ~byte & 0xff));
    const decipher = createDecipheriv('aes-128-gcm', aesKey, flipped);
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - 16)),
      decipher.final(),
    ]);
    expect(JSON.parse(plain.toString('utf8'))).toEqual({ data: { status: 'active' } });
  });

  it('takes the private key as a PEM or as Base64', () => {
    const asBase64 = Buffer.from(keys.privateKey, 'utf8').toString('base64');
    const { request } = asMeta({ action: 'ping' }, keys.publicKey);
    expect(decryptFlowRequest(request, flowPrivateKey(asBase64)).body).toEqual({ action: 'ping' });
  });

  it('refuses another key, or data changed on the way', () => {
    const { request } = asMeta({ action: 'ping' }, pair().publicKey);
    expect(() => decryptFlowRequest(request, privateKey)).toThrow(FlowDecryptError);
    const ours = asMeta({ action: 'ping' }, keys.publicKey).request;
    const tampered = Buffer.from(ours.encrypted_flow_data, 'base64');
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    expect(() =>
      decryptFlowRequest({ ...ours, encrypted_flow_data: tampered.toString('base64') }, privateKey),
    ).toThrow(FlowDecryptError);
  });
});
