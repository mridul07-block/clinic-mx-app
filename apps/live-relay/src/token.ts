/**
 * The realtime relay's connect token (FND-09; docs/runbooks/live-relay.md). The app signs one for a
 * signed in staff member: who they are, the centres whose changes they may hear about (the centres
 * they see), and a minute to connect. The relay checks it before it takes the socket. HMAC-SHA256
 * with a secret both share, through WebCrypto, so the same code runs in Node and in the Worker.
 * It names staff and centres only, never a patient.
 */

export interface LiveRelayClaims {
  staffId: string;
  centres: string[];
  /** When the token stops working, in milliseconds since the epoch. */
  expiresAt: number;
}

/** The shortest secret either side accepts. */
export const LIVE_RELAY_SECRET_MIN = 32;
/** The most centres one token names (the clinic has three). */
export const LIVE_RELAY_CENTRES_MAX = 20;

const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < LIVE_RELAY_SECRET_MIN) {
    throw new Error('The live relay secret is too short.');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signLiveToken(claims: LiveRelayClaims, secret: string): Promise<string> {
  const body = toBase64url(
    encoder.encode(JSON.stringify({ s: claims.staffId, c: claims.centres, e: claims.expiresAt })),
  );
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return [body, toBase64url(new Uint8Array(signature))].join('.');
}

/** The claims of a token signed with this secret and not yet expired; null otherwise. */
export async function verifyLiveToken(
  token: string,
  secret: string,
  now: number,
): Promise<LiveRelayClaims | null> {
  const [body, signed, ...rest] = token.split('.');
  if (!body || !signed || rest.length > 0) return null;
  const signature = fromBase64url(signed);
  const bytes = fromBase64url(body);
  if (!signature || !bytes) return null;
  // Constant time: WebCrypto's verify compares the signatures.
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    encoder.encode(body),
  );
  if (!valid) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const { s, c, e } = (parsed ?? {}) as { s?: unknown; c?: unknown; e?: unknown };
  if (
    typeof s !== 'string' ||
    !uuid.test(s) ||
    !Array.isArray(c) ||
    c.length > LIVE_RELAY_CENTRES_MAX ||
    !c.every((centre): centre is string => typeof centre === 'string' && uuid.test(centre)) ||
    typeof e !== 'number' ||
    e <= now
  ) {
    return null;
  }
  return { staffId: s, centres: c, expiresAt: e };
}
