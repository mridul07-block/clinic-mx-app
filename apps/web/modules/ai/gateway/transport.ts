import 'server-only';
import { usdToMicroUsd } from '@clinic-mx/schemas';
import { serverEnv } from '../../../lib/env';

/**
 * The one way out to a model (AI-01; TAD section 7): OpenRouter's chat completions. The request is
 * built by the gateway (`buildRequest`), which always asks for zero data retention; this only
 * sends it and reads the answer, its cost and its tokens. Nothing of the request or the answer
 * ever goes into an error.
 */
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface AiRequest {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  provider: {
    zdr: true;
    data_collection: 'deny';
    require_parameters: true;
    order?: string[];
    allow_fallbacks?: false;
  };
  response_format: {
    type: 'json_schema';
    json_schema: { name: string; strict: true; schema: unknown };
  };
  max_tokens: number;
  reasoning?: { effort: 'low' | 'medium' | 'high' };
}

export type AiTransportResult =
  | {
      ok: true;
      content: string;
      model: string | null;
      provider: string | null;
      costMicroUsd: bigint | null;
      tokensIn: number | null;
      tokensOut: number | null;
    }
  | { ok: false; failure: 'timeout' | 'network' | 'http'; httpStatus?: number };

export interface AiTransport {
  complete(request: AiRequest, signal: AbortSignal): Promise<AiTransportResult>;
}

const isTimeout = (error: unknown) =>
  error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const whole = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

export function openRouterTransport(apiKey: string, send: typeof fetch = fetch): AiTransport {
  return {
    async complete(request, signal) {
      let response: Response;
      try {
        response = await send(OPENROUTER_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(request),
          cache: 'no-store',
          signal,
        });
      } catch (error) {
        return { ok: false, failure: isTimeout(error) ? 'timeout' : 'network' };
      }
      if (!response.ok) return { ok: false, failure: 'http', httpStatus: response.status };
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        // The timeout covers reading the answer too.
        if (signal.aborted || isTimeout(error)) return { ok: false, failure: 'timeout' };
        return { ok: false, failure: 'http', httpStatus: response.status };
      }
      const answer = body as {
        model?: unknown;
        provider?: unknown;
        choices?: { message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
      };
      return {
        ok: true,
        content: text(answer.choices?.[0]?.message?.content) ?? '',
        model: text(answer.model),
        provider: text(answer.provider),
        costMicroUsd: usdToMicroUsd(answer.usage?.cost),
        tokensIn: whole(answer.usage?.prompt_tokens),
        tokensOut: whole(answer.usage?.completion_tokens),
      };
    },
  };
}

export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

/** The key's credit limit and use, in US dollars (`limitUsd` null: the key has no limit). */
export interface AiKeyStatus {
  limitUsd: number | null;
  usageUsd: number;
  remainingUsd: number | null;
}

const dollars = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * The key's own credit limit, the only hard stop on spending: a timed out attempt is billed but
 * its cost never comes back, so the daily cap cannot count it (AI-01). Null when it cannot be read.
 */
export async function openRouterKeyStatus(
  apiKey: string,
  send: typeof fetch = fetch,
): Promise<AiKeyStatus | null> {
  try {
    const response = await send(OPENROUTER_KEY_URL, {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = ((await response.json()) as { data?: Record<string, unknown> }).data ?? {};
    const usageUsd = dollars(data.usage);
    if (usageUsd === null) return null;
    return {
      limitUsd: dollars(data.limit),
      usageUsd,
      remainingUsd: dollars(data.limit_remaining),
    };
  } catch {
    return null;
  }
}

/** OpenRouter with the server's key; null without one (locally and in CI): nothing is called. */
export function defaultTransport(): AiTransport | null {
  const key = serverEnv().OPENROUTER_API_KEY;
  return key ? openRouterTransport(key) : null;
}
