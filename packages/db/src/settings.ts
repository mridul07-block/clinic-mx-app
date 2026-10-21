import {
  isSettingKey,
  parseSetting,
  settingDefinitions,
  settingKeys,
  type SettingKey,
  type SettingValue,
  type Settings,
} from '@clinic-mx/schemas';
import { eq } from 'drizzle-orm';
import { withActor, type Actor, type AuditContext } from './audit';
import type { Db } from './client';
import { setting } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Reading and changing settings (FND-14, rule 6). Code reads every business rule through a
 * settings reader, never from a constant; see docs/runbooks/settings.md.
 */

/** A setting is missing, malformed or unknown. Not recoverable by retrying. */
export class SettingsError extends Error {
  override name = 'SettingsError';
}

/**
 * How long a reader keeps the settings it loaded. A change made through the same reader shows
 * at once; one made on another server instance shows within this time.
 */
export const SETTINGS_CACHE_SECONDS = 60;

interface StoredSetting {
  key: string;
  value: unknown;
}

export function readSettingRows(db: DbOrTransaction): Promise<StoredSetting[]> {
  return db.select({ key: setting.key, value: setting.value }).from(setting);
}

/**
 * Validates the stored rows against the registry. Every setting must be present and well formed;
 * the error lists every one that is not. Rows for keys the code no longer knows are ignored.
 */
export function parseSettings(rows: StoredSetting[]): Settings {
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const values: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const key of settingKeys) {
    if (!stored.has(key)) {
      problems.push(`${key} is missing`);
      continue;
    }
    const parsed = settingDefinitions[key].schema.safeParse(stored.get(key));
    if (parsed.success) values[key] = parsed.data;
    else
      problems.push(`${key} is invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  if (problems.length > 0)
    throw new SettingsError(`Settings are not usable: ${problems.join(', ')}`);
  // Every key was checked against its own schema above.
  return values as Settings;
}

export interface SettingsReader {
  get<K extends SettingKey>(key: K): Promise<SettingValue<K>>;
  all(): Promise<Settings>;
  /** Forgets the loaded settings; the next read loads them again. */
  invalidate(): void;
}

export interface SettingsReaderOptions {
  maxAgeSeconds?: number;
  /** The clock, in milliseconds; tests replace it. */
  now?: () => number;
}

/**
 * The one cached accessor (TAD section 3). Loads the whole table at once (it is small), keeps it
 * for `maxAgeSeconds`, and shares one load between reads that arrive together. A failed load is
 * not kept, so the next read tries again.
 */
export function createSettingsReader(
  load: () => Promise<StoredSetting[]>,
  { maxAgeSeconds = SETTINGS_CACHE_SECONDS, now = Date.now }: SettingsReaderOptions = {},
): SettingsReader {
  let cached: { settings: Promise<Settings>; loadedAt: number } | undefined;

  function all(): Promise<Settings> {
    if (cached && now() - cached.loadedAt < maxAgeSeconds * 1000) return cached.settings;
    const entry = { settings: load().then(parseSettings), loadedAt: now() };
    cached = entry;
    entry.settings.catch(() => {
      if (cached === entry) cached = undefined;
    });
    return entry.settings;
  }

  return {
    all,
    get: async (key) => (await all())[key],
    invalidate: () => {
      cached = undefined;
    },
  };
}

/**
 * Changes one setting on behalf of `actor`, validated against its definition and audited with
 * the value before and after. Permission (Super Admin only) is checked by the caller's module
 * service. Invalidate the reader afterwards.
 */
export async function updateSetting<K extends SettingKey>(
  db: Db,
  context: AuditContext | Actor,
  key: K,
  value: SettingValue<K>,
): Promise<SettingValue<K>> {
  if (!isSettingKey(key)) throw new SettingsError(`Unknown setting: ${String(key)}`);
  const parsed = parseSetting(key, value);
  const actor = typeof context === 'string' ? context : context.actor;
  const updated = await withActor(db, context, (tx) =>
    tx
      .update(setting)
      .set({ value: parsed, updatedBy: actor, updatedAt: new Date() })
      .where(eq(setting.key, key))
      .returning({ key: setting.key }),
  );
  if (updated.length === 0) throw new SettingsError(`${key} is missing`);
  return parsed;
}
