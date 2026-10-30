import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  privateDecrypt,
  type KeyObject,
} from 'node:crypto';

/**
 * Meta's encryption for a WhatsApp Flow data endpoint (WA-04; TAD section 6). Each request carries
 * a fresh AES-128 key wrapped with our RSA public key (OAEP, SHA-256) and the Flow's data sealed
 * with AES-128-GCM (the last 16 bytes are the tag). The answer is sealed with the same key and the
 * IV with every bit flipped, and sent as Base64 text. The private key is ours alone, in the
 * environment; nothing decrypted is ever logged.
 */

export interface EncryptedFlowRequest {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

export interface DecryptedFlowRequest {
  body: unknown;
  aesKey: Buffer;
  iv: Buffer;
}

export class FlowDecryptError extends Error {
  override name = 'FlowDecryptError';
}

const TAG_LENGTH = 16;

/** The private key from `WHATSAPP_FLOW_PRIVATE_KEY`: a PEM, or a PEM written as Base64. */
export function flowPrivateKey(value: string): KeyObject {
  const pem = value.includes('-----BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8');
  return createPrivateKey(pem);
}

export function decryptFlowRequest(
  request: EncryptedFlowRequest,
  privateKey: KeyObject,
): DecryptedFlowRequest {
  try {
    const aesKey = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(request.encrypted_aes_key, 'base64'),
    );
    const iv = Buffer.from(request.initial_vector, 'base64');
    const sealed = Buffer.from(request.encrypted_flow_data, 'base64');
    const decipher = createDecipheriv('aes-128-gcm', aesKey, iv);
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH));
    const plain = Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_LENGTH)),
      decipher.final(),
    ]);
    return { body: JSON.parse(plain.toString('utf8')) as unknown, aesKey, iv };
  } catch {
    // Wrong key, tampered data or not JSON: Meta fetches our public key again and retries (421).
    throw new FlowDecryptError('The Flow request could not be decrypted.');
  }
}

export function encryptFlowResponse(response: unknown, aesKey: Buffer, iv: Buffer): string {
  const flipped = Buffer.from(iv.map((byte) => ~byte & 0xff));
  const cipher = createCipheriv('aes-128-gcm', aesKey, flipped);
  return Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}
