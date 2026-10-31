import { LiveHub } from './hub';
import { verifyLiveToken } from './token';

/**
 * The realtime relay (FND-09; TAD section 8; docs/runbooks/live-relay.md). Staff screens hold a
 * WebSocket here; the database tells it which centres changed (never what changed), and it pings
 * the screens watching those centres, which then check for changes through the app's own
 * permission checked routes. It never reaches Supabase and holds no patient data, so browsers
 * talk only to our own hosts (rule 9).
 *
 * - `GET /connect?token=…`: a WebSocket, for a token the app signed (`./token`) from an allowed
 *   origin.
 * - `POST /signal`: from the database (pg_net), with the signal secret; `{ centres, all }`.
 * - `GET /health`.
 */
export { LiveHub };

export interface Env {
  HUB: DurableObjectNamespace<LiveHub>;
  /** Signs connect tokens; the app's LIVE_RELAY_TOKEN_SECRET. */
  TOKEN_SECRET: string;
  /** The database's Bearer secret; Vault's live_relay_signal_secret. */
  SIGNAL_SECRET: string;
  /** The app's origins, comma separated. */
  ALLOWED_ORIGINS: string;
}

export interface Signal {
  centres: string[];
  all: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNAL_CENTRES_MAX = 100;

/** A signal as the database sends it; null for anything else. */
export function parseSignal(value: unknown): Signal | null {
  const { centres, all } = (value ?? {}) as { centres?: unknown; all?: unknown };
  if (
    typeof all !== 'boolean' ||
    !Array.isArray(centres) ||
    centres.length > SIGNAL_CENTRES_MAX ||
    !centres.every((centre): centre is string => typeof centre === 'string' && uuid.test(centre))
  ) {
    return null;
  }
  return { centres, all };
}

export function originAllowed(origin: string | null, allowed: string): boolean {
  if (!origin) return false;
  return allowed
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry !== '' && entry === origin);
}

/** Whether the Authorization header carries the secret, compared in constant time. */
async function bearerMatches(header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith('Bearer ') || secret.length < 32) return false;
  const digest = (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const [given, expected] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  return crypto.subtle.timingSafeEqual(given, expected);
}

const hubOf = (env: Env) => env.HUB.get(env.HUB.idFromName('clinic'));

const plain = (status: number, text: string) =>
  new Response(text, { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return plain(200, 'ok');

    if (url.pathname === '/connect' && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return plain(426, 'Expected a WebSocket');
      }
      if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
        return plain(403, 'Origin not allowed');
      }
      const claims = await verifyLiveToken(
        url.searchParams.get('token') ?? '',
        env.TOKEN_SECRET,
        Date.now(),
      );
      if (!claims) return plain(401, 'Token refused');
      const target = new URL('https://hub/connect');
      for (const centre of claims.centres) target.searchParams.append('centre', centre);
      return hubOf(env).fetch(new Request(target, request));
    }

    if (url.pathname === '/signal' && request.method === 'POST') {
      if (!(await bearerMatches(request.headers.get('Authorization'), env.SIGNAL_SECRET))) {
        return plain(401, 'Not allowed');
      }
      const signal = parseSignal(await request.json().catch(() => null));
      if (!signal) return plain(400, 'Not a signal');
      return hubOf(env).fetch('https://hub/signal', {
        method: 'POST',
        body: JSON.stringify(signal),
      });
    }

    return plain(404, 'Not found');
  },
} satisfies ExportedHandler<Env>;
