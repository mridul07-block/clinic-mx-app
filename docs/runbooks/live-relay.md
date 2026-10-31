# The realtime relay (FND-09)

Live screens show a change within 2 seconds (PRD section 9; TAD section 8, "Realtime"). The four
live screens are the Calendar, Today, My patients and the emergency banners.

## Status: built, not deployed

The relay is built and tested on this machine. It waits for the clinic's Cloudflare account,
which was deferred on 21 October 2026.

Until it is deployed and switched on:
- nothing changes: every live screen checks for changes on its own every `live.refresh_seconds`
  (3 s), as before;
- the database sends nothing (no Vault rows);
- the app hands out no tickets (no `LIVE_RELAY_URL`).

## How it works

**Signals, not rows** (user decision, 31 October 2026, a deliberate departure from the TAD's
relayed Supabase Realtime): nothing about a patient passes through Cloudflare, and the browser never
holds a Supabase token. The rows and the permissions stay where they are.

1. **The database signals.** A change to a table a live screen shows sends `{centres, all}`, the
   centres that changed, to the relay through pg_net. The migration is
   `supabase/migrations/20261031113718_live_signals.sql`; the triggers are statement level and work
   out the centre in one of four ways:
   - the row's own centre: appointment, slot hold, roster, bill, session, opening entry;
   - its episode's centre: red flag alert, preparation sheet, plan of care, plan choice;
   - its appointment's centre, else its episode's: consent, consultation, patient link;
   - every centre: leave.

   pg_net sends after the commit, so a change rolled back signals nothing, and a relay that is down
   never holds up a change. A signal that cannot be made is only a warning; the change goes ahead.
   With no relay in Vault the triggers stop at once.
2. **The relay** (`apps/live-relay`, a Cloudflare Worker with one Durable Object, `LiveHub`):
   - **`GET /connect?token=…`:** takes a WebSocket only for a token the app signed (HMAC-SHA256,
     a minute to connect), and only from an origin in `ALLOWED_ORIGINS`. The socket remembers the
     token's centres.
   - **`POST /signal`:** takes a signal only with the database's Bearer secret. It pings only the
     sockets of the centres named (every socket for `all`) and tells each only its own centres.
   - **`GET /health`.**
   - Hibernating sockets; "ping" is answered "pong". Nothing is stored and nothing is logged.
3. **The app:**
   - `GET /app/live/relay` gives a signed in person a ticket: the relay's address and a token naming
     them and the centres they see (`switchableCentres`), or 204 where the relay is not set up.
   - One socket per tab (`apps/web/lib/live-relay.ts`, `LiveRelayProvider` in the signed in layout).
     It takes a fresh ticket for each connect, reconnects 1, 2, 4 … 30 s apart, pings every 25 s, and
     treats a socket silent for a minute as gone.
4. **The screens** (`scheduleLiveChecks`):
   - on a signal for their centre, they check at once (signals within 200 ms run one check);
   - while connected, they still check on their own every `live.connected_check_seconds` (15 s);
   - while not connected, every `live.refresh_seconds` (3 s).

   Calendar and Today watch their centre; My patients and the emergency banners watch any. "Live,
   updated n s ago", and the amber "Not updated for n s", are unchanged.

## Deploying it (once the Cloudflare account exists)

1. **The account:** the clinic creates the free Cloudflare account and a Workers API token (Workers
   Scripts and Durable Objects edit), and puts it in the environment as `CLOUDFLARE_API_TOKEN`.
   Never paste it into a page.
2. **Two secrets:** make each with `openssl rand -hex 32`. Never print them; paste them straight
   into the prompts.
   - **Token secret:** `pnpm --filter @clinic-mx/live-relay exec wrangler secret put TOKEN_SECRET`,
     and the same value as `LIVE_RELAY_TOKEN_SECRET` in Vercel (staging, later production).
   - **Signal secret:** `wrangler secret put SIGNAL_SECRET`, and the same value in the staging
     database's Vault:
     `select vault.create_secret('<signal secret>', 'live_relay_signal_secret');`
3. **Deploy:** `pnpm --filter @clinic-mx/live-relay deploy`. Wrangler prints the address,
   `https://clinic-mx-live-relay.<account>.workers.dev`; check `/health`.
4. **The database's URL:**
   `select vault.create_secret('https://clinic-mx-live-relay.<account>.workers.dev/signal', 'live_relay_signal_url');`
5. **The app's URL:** `LIVE_RELAY_URL=wss://clinic-mx-live-relay.<account>.workers.dev` in Vercel.
   Redeploy.
6. **The origins:** `ALLOWED_ORIGINS` in `apps/live-relay/wrangler.toml` lists the app's origins.
   Add the clinic domain with FND-05, and move the relay to `realtime.<clinic domain>` then.
7. **Check it:** two signed in browsers on Today. A booking on one shows on the other within 2
   seconds.

## Turning it off

Any one of these takes the screens back to checking every `live.refresh_seconds`:
- remove `LIVE_RELAY_URL` from Vercel;
- delete the two Vault rows;
- delete the Worker.

## Tests

- **The relay** (`apps/live-relay/test`): it runs locally under wrangler, with no account needed.
  It covers the token, refused connects (origin, expired, forged) and refused signals (secret,
  body), each signal reaching only its centres' sockets, `all`, and ping.
- **The database** (`packages/db/src/integration/live-signals.integration.test.ts`):
  - nothing is sent until it is set up;
  - a booking names only its centre, with the secret;
  - a rollback or a no-op sends nothing;
  - leave goes everywhere;
  - each mapping works before and after a move;
  - a broken signal never fails the change;
  - staff writes find the centre;
  - all 14 tables carry their triggers.
- **The app:** the client (reconnects, backoff, pings, the check schedule, debounce) and the ticket
  route.
- **End to end with a real relay:** `bash scripts/live-relay-e2e.sh`. It starts the relay locally,
  points the local database at it, and slows the screens' own checks to a minute, so only the relay
  can update them; then it runs `e2e/live-relay.spec.ts` at 360 px and desktop, and puts everything
  back.
  - **First run, 31 October 2026:** a booking reached another desk's Today and Calendar in 262 and
    273 ms on desktop, and 722 and 737 ms on the phone.
  - CI runs with the relay off; every other live spec covers that.
