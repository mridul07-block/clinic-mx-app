import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const limits = vi.hoisted(() => ({
  count: vi.fn(),
  limited: vi.fn(),
  networkKey: (address: string | undefined) => address ?? 'unknown',
}));
vi.mock('../../../../modules/rate-limits/limits', () => limits);
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(() => 'event-1'),
  flush: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('@sentry/nextjs', () => sentry);

// A stand-in of the length the environment needs (32 or more), built so it never reads as a key.
const secret = 'x'.repeat(40);
const check = (authorization?: string) =>
  POST(
    new Request('http://localhost/api/monitoring/check', {
      method: 'POST',
      headers: {
        'x-real-ip': '203.0.113.9',
        ...(authorization ? { authorization } : {}),
      },
    }),
  );

// FND-12: the monitoring drill reports a test error carrying fake patient details.
describe('POST /api/monitoring/check', () => {
  beforeEach(() => {
    vi.stubEnv('JOBS_SECRET', secret);
    limits.count.mockReset();
    limits.limited.mockReset();
    limits.limited.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
    sentry.captureException.mockClear();
  });

  it('refuses a wrong secret and counts it against the network', async () => {
    const response = await check('Bearer not-the-secret');
    expect(response.status).toBe(401);
    expect(limits.count).toHaveBeenCalledWith('webhook_failures_per_network', '203.0.113.9');
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('answers 429 over the limit, before checking the secret', async () => {
    limits.limited.mockResolvedValue({ limited: true, retryAfterSeconds: 42 });
    const response = await check(`Bearer ${secret}`);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports a test error carrying the planted details, and says which', async () => {
    const response = await check(`Bearer ${secret}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { eventId: string; sent: boolean; planted: string[] };
    expect(body.eventId).toBe('event-1');
    expect(body.sent).toBe(true);
    expect(body.planted).toHaveLength(5);
    const [error] = sentry.captureException.mock.calls[0] as unknown as [Error];
    expect(error.name).toBe('MonitoringCheckError');
    for (const planted of body.planted) expect(error.message).toContain(planted);
  });

  it('plants fresh details every time', async () => {
    const first = (await (await check(`Bearer ${secret}`)).json()) as { planted: string[] };
    const second = (await (await check(`Bearer ${secret}`)).json()) as { planted: string[] };
    expect(first.planted).not.toEqual(second.planted);
  });
});
