import {
  createDb,
  createSettingsReader,
  readSettingRows,
  type SettingsReader,
} from '@clinic-mx/db';
import type { SettingKey, SettingValue } from '@clinic-mx/schemas';
import { serverEnv } from '../../lib/env';

/**
 * Business rules for server code (FND-14, rule 6): `await getSetting('day.running_late_minutes')`.
 * One reader per server instance, cached for SETTINGS_CACHE_SECONDS; see
 * docs/runbooks/settings.md. Changing settings arrives with the Super Admin settings screen,
 * which calls `invalidateSettings()` after `updateSetting`.
 */
let reader: SettingsReader | undefined;

function settingsReader(): SettingsReader {
  if (!reader) {
    const url = serverEnv().DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set, so settings cannot be read.');
    const { db } = createDb(url, { max: 1 });
    reader = createSettingsReader(() => readSettingRows(db));
  }
  return reader;
}

export function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  return settingsReader().get(key);
}

export function invalidateSettings(): void {
  reader?.invalidate();
}
