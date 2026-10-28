import { createSettingsReader, readSettingRows, type SettingsReader } from '@clinic-mx/db';
import type { SettingKey, SettingValue } from '@clinic-mx/schemas';
import { settingsDb } from '../../lib/db';

/**
 * Business rules for server code (FND-14, rule 6): `await getSetting('day.running_late_minutes')`.
 * One reader per server instance, cached for SETTINGS_CACHE_SECONDS, loading on its own connection
 * (`settingsDb`), so a read inside a service transaction never waits on that transaction; see
 * docs/runbooks/settings.md. Settings the Super Admin switches have their own services (opening
 * entries, the AI preparation sheet), each calling `invalidateSettings()` after the write.
 */
let reader: SettingsReader | undefined;

function settingsReader(): SettingsReader {
  if (!reader) {
    const db = settingsDb();
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
