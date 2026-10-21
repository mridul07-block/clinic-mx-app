import { healthResponseSchema } from '@clinic-mx/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports ok with local defaults outside Vercel', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);
    vi.stubEnv('VERCEL_REGION', undefined);

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      status: 'ok',
      commit: 'local',
      region: 'local',
    });
  });

  it('reports the short commit and the function region on Vercel', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'f6a2366c0ffee0000000000000000000000000ab');
    vi.stubEnv('VERCEL_REGION', 'bom1');

    const body = healthResponseSchema.parse(await GET().json());

    expect(body).toEqual({ status: 'ok', commit: 'f6a2366', region: 'bom1' });
  });
});
