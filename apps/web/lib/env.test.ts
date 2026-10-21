import { afterEach, describe, expect, it, vi } from 'vitest';

import { serverEnv } from './env';

describe('serverEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads Vercel variables', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_REGION', 'bom1');
    expect(serverEnv()).toMatchObject({ VERCEL_ENV: 'preview', VERCEL_REGION: 'bom1' });
  });

  it('treats empty values as unset', () => {
    vi.stubEnv('VERCEL_ENV', '');
    expect(serverEnv().VERCEL_ENV).toBeUndefined();
  });

  it('rejects an unknown Vercel environment', () => {
    vi.stubEnv('VERCEL_ENV', 'staging');
    expect(() => serverEnv()).toThrow();
  });
});
