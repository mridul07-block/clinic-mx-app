import 'server-only';
import { z } from 'zod';
import { serverEnv } from '../../lib/env';
import { requestAddress } from '../../lib/network';
import { count, limited, networkKey } from '../rate-limits/limits';
import type { FlowStepRequest, FlowStepResult } from './booking-flow';
import {
  FlowDecryptError,
  decryptFlowRequest,
  encryptFlowResponse,
  flowPrivateKey,
} from './flow-crypto';
import { validWebhookSignature } from './webhook-signature';

// A WhatsApp Flow's data endpoint (WA-04, WA-05; TAD sections 5 and 6, docs/runbooks/whatsapp.md).
// Meta posts each screen signed with the app secret and sealed with our public key; the answer
// goes back sealed with the same one-time key. A wrong signature is 432, a request we cannot open
// 421 (Meta fetches our key again), a Flow token we do not know (or of the other Flow) 427.
// Refused calls are limited per network like the webhook. Nothing of a request is ever logged.

/** Larger than any request Meta sends (a technical limit, not a business rule). */
const MAX_BODY_BYTES = 200_000;

const envelope = z.object({
  encrypted_flow_data: z.string().min(1),
  encrypted_aes_key: z.string().min(1),
  initial_vector: z.string().min(1),
});

const decrypted = z.object({
  action: z.string(),
  screen: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  flow_token: z.string().optional(),
});

const plain = (status: number) => new Response(null, { status });

/** The POST handler of one Flow's endpoint, handing each opened screen to `step`. */
export function flowEndpoint(
  step: (request: FlowStepRequest) => Promise<FlowStepResult>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const env = serverEnv();
    if (!env.WHATSAPP_APP_SECRET || !env.WHATSAPP_FLOW_PRIVATE_KEY) return plain(503);
    const network = networkKey(requestAddress(request.headers));
    const over = await limited('webhook_failures_per_network', network);
    if (over.limited) {
      return new Response(null, {
        status: 429,
        headers: { 'Retry-After': String(over.retryAfterSeconds) },
      });
    }
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) return plain(413);
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_BODY_BYTES) return plain(413);
    if (
      !validWebhookSignature(
        body,
        request.headers.get('x-hub-signature-256'),
        env.WHATSAPP_APP_SECRET,
      )
    ) {
      await count('webhook_failures_per_network', network);
      return plain(432);
    }

    let opened: ReturnType<typeof decryptFlowRequest>;
    try {
      const sealed = envelope.parse(JSON.parse(new TextDecoder().decode(body)));
      opened = decryptFlowRequest(sealed, flowPrivateKey(env.WHATSAPP_FLOW_PRIVATE_KEY));
    } catch (error) {
      if (error instanceof FlowDecryptError) return plain(421);
      return plain(400);
    }
    const answer = (response: unknown) =>
      new Response(encryptFlowResponse(response, opened.aesKey, opened.iv), {
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
      });

    const parsed = decrypted.safeParse(opened.body);
    if (!parsed.success) return plain(400);
    const { action, data } = parsed.data;
    // Meta's health check, and its notice of an error it showed the person.
    if (action === 'ping') return answer({ data: { status: 'active' } });
    if (data && ('error' in data || 'error_message' in data) && !('step' in data)) {
      return answer({ data: { acknowledged: true } });
    }
    const result = await step({
      action,
      screen: parsed.data.screen,
      data,
      flow_token: parsed.data.flow_token ?? '',
    });
    if ('unknownToken' in result) return plain(427);
    return answer(result);
  };
}
