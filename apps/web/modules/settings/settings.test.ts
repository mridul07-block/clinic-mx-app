import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getSetting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fails clearly when the database is not configured', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { getSetting } = await import('./settings');
    expect(() => getSetting('day.running_late_minutes')).toThrow('DATABASE_URL is not set');
  });
});
