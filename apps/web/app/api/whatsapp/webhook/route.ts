import { whatsappWebhookSchema } from '@clinic-mx/schemas';
import { after } from 'next/server';
import { appDb } from '../../../../lib/db';
import { serverEnv } from '../../../../lib/env';
import { requestAddress } from '../../../../lib/network';
import { routeInboundMessage } from '../../../../modules/messaging/router';
import { handleWhatsappEvent, receiveWhatsappWebhook } from '../../../../modules/messaging/webhook';
import {
  validVerifyToken,
  validWebhookSignature,
} from '../../../../modules/messaging/webhook-signature';
import { count, limited, networkKey } from '../../../../modules/rate-limits/limits';

// Meta's WhatsApp webhook (WA-02; TAD sections 5 and 6, docs/runbooks/whatsapp.md). GET answers
// Meta's subscribe check; POST takes delivery statuses and inbound messages. A body is accepted
// only with the app secret's signature over its exact bytes; it is stored, which queues its job,
// and answered at once, then handled and its messages routed straight after (the jobs are the
// fallback). Wrong signatures
// and verify tokens are limited per network like the job tick (IAM-11). Nothing of a body is ever
// logged.
export const dynamic = 'force-dynamic';

/** Larger than any body Meta sends (a technical limit, not a business rule). */
const MAX_BODY_BYTES = 1_000_000;

const tooMany = (retryAfterSeconds: number) =>
  Response.json(
    { error: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );

export async function GET(request: Request): Promise<Response> {
  const network = networkKey(requestAddress(request.headers));
  const over = await limited('webhook_failures_per_network', network);
  if (over.limited) return tooMany(over.retryAfterSeconds);
  const query = new URL(request.url).searchParams;
  const challenge = query.get('hub.challenge');
  if (
    query.get('hub.mode') !== 'subscribe' ||
    !challenge ||
    !validVerifyToken(query.get('hub.verify_token'), serverEnv().WHATSAPP_WEBHOOK_VERIFY_TOKEN)
  ) {
    await count('webhook_failures_per_network', network);
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return new Response(challenge, {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const secret = serverEnv().WHATSAPP_APP_SECRET;
  if (!secret) return Response.json({ error: 'Not configured' }, { status: 503 });
  const network = networkKey(requestAddress(request.headers));
  const over = await limited('webhook_failures_per_network', network);
  if (over.limited) return tooMany(over.retryAfterSeconds);

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ error: 'Too large' }, { status: 413 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Too large' }, { status: 413 });
  }
  if (!validWebhookSignature(body, request.headers.get('x-hub-signature-256'), secret)) {
    await count('webhook_failures_per_network', network);
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return Response.json({ error: 'Not JSON' }, { status: 400 });
  }
  // Signed by Meta but not about WhatsApp messages: nothing to keep, and Meta must not retry it.
  if (!whatsappWebhookSchema.safeParse(payload).success) {
    return Response.json({ ignored: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const db = appDb();
  const eventId = await receiveWhatsappWebhook(db, { payload });
  after(async () => {
    try {
      const handled = await handleWhatsappEvent(db, eventId);
      // WA-03: each message sent to us gets its route and reply now, not at the next tick.
      for (const messageId of handled.receivedIds) await routeInboundMessage(db, messageId);
    } catch {
      // Its `whatsapp.event` and `whatsapp.route` jobs handle it at the next tick, and try again
      // after a failure.
    }
  });
  return Response.json({ received: true }, { headers: { 'Cache-Control': 'no-store' } });
}
