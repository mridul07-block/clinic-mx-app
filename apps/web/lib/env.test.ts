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

  it('accepts a Postgres database URL and a long jobs secret', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@db.example.test:6543/postgres');
    vi.stubEnv('JOBS_SECRET', 'x'.repeat(32));
    expect(serverEnv()).toMatchObject({ JOBS_SECRET: 'x'.repeat(32) });
  });

  it('rejects a database URL that is not Postgres, and a short jobs secret', () => {
    vi.stubEnv('DATABASE_URL', 'https://db.example.test');
    expect(() => serverEnv()).toThrow();
    vi.unstubAllEnvs();
    vi.stubEnv('JOBS_SECRET', 'too-short');
    expect(() => serverEnv()).toThrow();
  });
});
