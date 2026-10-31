import { verifyLiveToken } from '@clinic-mx/live-relay/token';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const session = vi.hoisted(() => ({ currentStaff: vi.fn() }));
vi.mock('../../../../../../modules/auth/session', () => session);
const centres = vi.hoisted(() => ({ switchableCentres: vi.fn() }));
vi.mock('../../../../../../modules/navigation/centres', () => centres);
const env = vi.hoisted(() => {
  const values: Record<string, string | undefined> = {};
  return { values };
});
vi.mock('../../../../../../lib/env', () => ({ serverEnv: () => env.values }));

// FND-09: the ticket to the realtime relay names the signed in person and only the centres they
// see, for a minute; none where the relay is not set up. Generated ids only.
const secret = 't'.repeat(40);
const staff = { id: '00000000-0000-4000-8000-0000000000a1', role: 'front_desk' };
const hsr = '00000000-0000-4000-8000-000000000101';

describe('the relay ticket', () => {
  beforeEach(() => {
    session.currentStaff.mockResolvedValue(staff);
    centres.switchableCentres.mockResolvedValue([{ id: hsr, name: 'HSR Layout', code: 'HSR' }]);
    env.values = { LIVE_RELAY_URL: 'wss://relay.example.test', LIVE_RELAY_TOKEN_SECRET: secret };
  });

  it('is refused when signed out', async () => {
    session.currentStaff.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it('is none where the relay is not set up', async () => {
    env.values = {};
    expect((await GET()).status).toBe(204);
    env.values = { LIVE_RELAY_URL: 'wss://relay.example.test' };
    expect((await GET()).status).toBe(204);
  });

  it('names the person and the centres they see, for a minute', async () => {
    const before = Date.now();
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const { url, token } = (await response.json()) as { url: string; token: string };
    expect(url).toBe('wss://relay.example.test');
    expect(centres.switchableCentres).toHaveBeenCalledWith(staff);
    const claims = await verifyLiveToken(token, secret, Date.now());
    expect(claims).toMatchObject({ staffId: staff.id, centres: [hsr] });
    expect(claims?.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(claims?.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(await verifyLiveToken(token, secret, Date.now() + 61_000)).toBeNull();
  });
});
