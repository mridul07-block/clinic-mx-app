import { afterEach, describe, expect, it, vi } from 'vitest';

const createDb = vi.hoisted(() => vi.fn((url: string) => ({ db: { url, n: Math.random() } })));
vi.mock('@clinic-mx/db', () => ({ createDb }));

describe('database clients', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    createDb.mockClear();
  });

  // A settings load inside an open service transaction must not queue behind it (the SET-03
  // stall): the settings cache has a connection of its own.
  it('gives the settings cache its own connection, each made once', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://app@localhost:6543/postgres');
    const { appDb, settingsDb } = await import('./db');
    const app = appDb();
    const settings = settingsDb();
    expect(settings).not.toBe(app);
    expect(appDb()).toBe(app);
    expect(settingsDb()).toBe(settings);
    expect(createDb).toHaveBeenCalledTimes(2);
    expect(createDb).toHaveBeenCalledWith(expect.any(String), { max: 1, idleTimeoutSeconds: 20 });
  });

  it('fails clearly when the database is not configured', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { settingsDb } = await import('./db');
    expect(() => settingsDb()).toThrow('DATABASE_URL is not set');
  });
});
