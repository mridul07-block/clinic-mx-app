import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const limits = vi.hoisted(() => ({
  count: vi.fn(),
  limited: vi.fn(),
  networkKey: (address: string | undefined) => address ?? 'unknown',
}));
vi.mock('../../../../modules/rate-limits/limits', () => limits);
const db = vi.hoisted(() => ({ createDb: vi.fn(), runDueJobs: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../../../modules/jobs/handlers', () => ({ jobHandlers: {} }));

// A stand-in of the length the environment needs (32 or more), built so it never reads as a key.
const secret = 'x'.repeat(40);
const tick = (authorization?: string) =>
  POST(
    new Request('http://localhost/api/jobs/tick', {
      method: 'POST',
      headers: {
        'x-real-ip': '203.0.113.9',
        ...(authorization ? { authorization } : {}),
      },
    }),
  );

// IAM-11: the job tick webhook limits calls with a wrong secret per network.
describe('POST /api/jobs/tick', () => {
  beforeEach(() => {
    vi.stubEnv('JOBS_SECRET', secret);
    vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/test');
    limits.count.mockReset();
    limits.limited.mockReset();
    limits.limited.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
    db.createDb.mockReturnValue({ db: {}, close: () => Promise.resolve() });
    db.runDueJobs.mockResolvedValue({ ran: 0 });
    vi.unstubAllGlobals();
  });

  it('counts a wrong secret against the network and refuses it', async () => {
    const response = await tick('Bearer not-the-secret');
    expect(response.status).toBe(401);
    expect(limits.count).toHaveBeenCalledWith('webhook_failures_per_network', '203.0.113.9');
    expect(db.runDueJobs).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After over the limit, before checking the secret', async () => {
    limits.limited.mockResolvedValue({ limited: true, retryAfterSeconds: 42 });
    const response = await tick(`Bearer ${secret}`);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(limits.count).not.toHaveBeenCalled();
    expect(db.runDueJobs).not.toHaveBeenCalled();
  });

  it('runs due jobs for the right secret, counting nothing', async () => {
    const response = await tick(`Bearer ${secret}`);
    expect(response.status).toBe(200);
    expect(db.runDueJobs).toHaveBeenCalled();
    expect(limits.count).not.toHaveBeenCalled();
  });

  // FND-12: each run tells the uptime service; its silence is the alert.
  describe('heartbeat', () => {
    const beat = 'https://uptime.example/api/v1/heartbeat/test';

    it('beats after a run', async () => {
      vi.stubEnv('JOBS_TICK_HEARTBEAT_URL', beat);
      const fetch = vi.fn().mockResolvedValue(new Response('OK'));
      vi.stubGlobal('fetch', fetch);
      expect((await tick(`Bearer ${secret}`)).status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(beat, expect.objectContaining({ cache: 'no-store' }));
    });

    it('never beats for a wrong secret', async () => {
      vi.stubEnv('JOBS_TICK_HEARTBEAT_URL', beat);
      const fetch = vi.fn().mockResolvedValue(new Response('OK'));
      vi.stubGlobal('fetch', fetch);
      expect((await tick('Bearer not-the-secret')).status).toBe(401);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('still answers 200 when the uptime service is down', async () => {
      vi.stubEnv('JOBS_TICK_HEARTBEAT_URL', beat);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
      expect((await tick(`Bearer ${secret}`)).status).toBe(200);
    });

    it('beats nowhere when no heartbeat is set', async () => {
      vi.stubEnv('JOBS_TICK_HEARTBEAT_URL', '');
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      expect((await tick(`Bearer ${secret}`)).status).toBe(200);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
