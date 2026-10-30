import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta signs every webhook body with the app secret (WA-02; TAD section 5):
 * `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>`. Checked on the bytes exactly
 * as they came, before anything is parsed, and compared in constant time.
 */

const PREFIX = 'sha256=';

export function webhookSignature(body: Uint8Array, secret: string): string {
  return PREFIX + createHmac('sha256', secret).update(body).digest('hex');
}

/** Hashing first gives both sides the same length, as timingSafeEqual needs. */
function sameInConstantTime(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function validWebhookSignature(
  body: Uint8Array,
  header: string | null,
  secret: string,
): boolean {
  if (!header?.startsWith(PREFIX)) return false;
  return sameInConstantTime(header.toLowerCase(), webhookSignature(body, secret));
}

/** Meta's subscribe check: it repeats the verify token we gave it. */
export function validVerifyToken(given: string | null, expected: string | undefined): boolean {
  if (!expected || given === null) return false;
  return sameInConstantTime(given, expected);
}
