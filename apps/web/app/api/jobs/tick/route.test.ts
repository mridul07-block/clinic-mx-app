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
});
