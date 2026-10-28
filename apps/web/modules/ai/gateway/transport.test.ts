import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PROMPTS } from './prompts';
import { OPENROUTER_URL, openRouterTransport, type AiRequest } from './transport';

vi.mock('../../../lib/env', () => ({ serverEnv: () => ({}) }));

const key = 'k'.repeat(40);
const request: AiRequest = {
  model: 'vendor/model-1',
  messages: [{ role: 'user', content: '{"case":{}}' }],
  provider: { zdr: true, data_collection: 'deny', require_parameters: true },
  response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: {} } },
  max_tokens: 10,
};
const signal = new AbortController().signal;

// AI-01: the only way out to a model, OpenRouter; the gateway's tests use a fake one.
describe('the OpenRouter transport', () => {
  it('posts the request with the key and reads the answer, cost and tokens', async () => {
    const send = vi.fn(() =>
      Promise.resolve(
        Response.json({
          model: 'vendor/model-1',
          provider: 'provider-a',
          choices: [{ message: { content: '{"ranked":[]}' } }],
          usage: { prompt_tokens: 900, completion_tokens: 60, cost: 0.0012 },
        }),
      ),
    );
    const result = await openRouterTransport(key, send).complete(request, signal);
    expect(result).toEqual({
      ok: true,
      content: '{"ranked":[]}',
      model: 'vendor/model-1',
      provider: 'provider-a',
      costMicroUsd: 1200n,
      tokensIn: 900,
      tokensOut: 60,
    });
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: `Bearer ${key}` });
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect(init.signal).toBe(signal);
  });

  it('reports a provider error, a network error and a timeout without their text', async () => {
    const http = openRouterTransport(key, () =>
      Promise.resolve(new Response('secret details', { status: 503 })),
    );
    expect(await http.complete(request, signal)).toEqual({
      ok: false,
      failure: 'http',
      httpStatus: 503,
    });
    const network = openRouterTransport(key, () => Promise.reject(new TypeError('fetch failed')));
    expect(await network.complete(request, signal)).toEqual({ ok: false, failure: 'network' });
    const timeout = openRouterTransport(key, () =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    expect(await timeout.complete(request, signal)).toEqual({ ok: false, failure: 'timeout' });
    // The answer started but timed out while being read.
    const slow = new AbortController();
    const reading = openRouterTransport(key, () => {
      const body = new ReadableStream({
        start: (controller) => {
          const reason = new DOMException('The operation timed out.', 'TimeoutError');
          slow.abort(reason);
          controller.error(reason);
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    expect(await reading.complete(request, slow.signal)).toEqual({ ok: false, failure: 'timeout' });
  });
});

// A prompt changes only as a new version (the blind test reruns when it does).
describe('the prompts', () => {
  it('are pinned by version', () => {
    const hashes = Object.fromEntries(
      Object.entries(PROMPTS).map(([version, text]) => [
        version,
        createHash('sha256').update(text).digest('hex').slice(0, 16),
      ]),
    );
    expect(hashes).toMatchInlineSnapshot(`
      {
        "rank_diagnoses.v1": "2e601ca02ca0e9e9",
        "rank_diagnoses.v2": "06028c23ada12f90",
        "recheck_with_findings.v1": "f7417437d9deda88",
        "recheck_with_findings.v2": "11d57daf16d6f880",
      }
    `);
  });
});
