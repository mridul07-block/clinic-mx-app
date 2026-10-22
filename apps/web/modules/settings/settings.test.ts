import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getSetting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('../../lib/db');
    vi.doUnmock('@clinic-mx/db');
    vi.resetModules();
  });

  it('fails clearly when the database is not configured', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { getSetting } = await import('./settings');
    expect(() => getSetting('day.running_late_minutes')).toThrow('DATABASE_URL is not set');
  });

  it('loads through the settings connection, never the app connection', async () => {
    const settingsConnection = { name: 'settings' };
    const appDb = vi.fn(() => {
      throw new Error('settings must not use the app connection');
    });
    const readSettingRows = vi.fn(() => Promise.resolve([]));
    vi.doMock('../../lib/db', () => ({ appDb, settingsDb: () => settingsConnection }));
    vi.doMock('@clinic-mx/db', () => ({
      readSettingRows,
      createSettingsReader: (load: () => Promise<unknown>) => ({
        get: async () => {
          await load();
          return 10;
        },
        invalidate: () => undefined,
      }),
    }));
    const { getSetting } = await import('./settings');
    await expect(getSetting('day.running_late_minutes')).resolves.toBe(10);
    expect(readSettingRows).toHaveBeenCalledWith(settingsConnection);
    expect(appDb).not.toHaveBeenCalled();
  });
});
