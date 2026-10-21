import { createHmac } from 'node:crypto';

// Authenticator app codes for end to end tests (IAM-02): RFC 6238 TOTP, SHA-1, 6 digits, 30 s,
// as Supabase Auth and the common authenticator apps use.

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(secret: string): Buffer {
  let bits = '';
  for (const char of secret.replace(/[\s=]/g, '').toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error('Not a base32 secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The code an authenticator app shows for `secret` at `time` (milliseconds). */
export function totpCode(secret: string, time = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}
