import { settingKeys } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { staffActor } from '../audit';
import { createDb } from '../client';
import { auditEvent, setting } from '../schema';
import { seedStaff } from '../seed/data';
import {
  SettingsError,
  createSettingsReader,
  parseSettings,
  readSettingRows,
  updateSetting,
} from '../settings';

// FND-14 done when: every rule in PRD section 7 is read from settings. The registry test in
// packages/schemas proves each PRD rule has a key; this proves each key has a usable value.
// Runs against the CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

const admin = seedStaff.find((s) => s.role === 'super_admin');
if (!admin?.id) throw new Error('seed has no super admin');
const actor = staffActor(admin.id);

describe('the settings table after migrations', () => {
  it('holds a valid value for every setting the code defines', async () => {
    const settings = parseSettings(await readSettingRows(db));
    expect(Object.keys(settings).sort()).toEqual([...settingKeys].sort());
  });

  it('holds the PRD section 7 values', async () => {
    const reader = createSettingsReader(() => readSettingRows(db));
    expect(await reader.get('day.running_late_minutes')).toBe(15);
    expect(await reader.get('day.no_show_allowed_minutes')).toBe(25);
    expect(await reader.get('packages.validity_months')).toBe(3);
    expect(await reader.get('engagement.follow_ups_after_discharge')).toEqual([
      { count: 2, unit: 'week' },
      { count: 6, unit: 'week' },
      { count: 3, unit: 'month' },
      { count: 12, unit: 'month' },
    ]);
  });

  it('is unreadable through the Supabase API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('role', ${role}, true)`);
        return tx.execute<{ n: number }>(sql`select count(*)::int as n from setting`);
      });
      expect(rows[0]?.n).toBe(0);
    }
  });
});

describe('changing a setting', () => {
  const key = 'billing.unpaid_sessions_flag_above';

  it('stores the value and who changed it, audited before and after', async () => {
    const reader = createSettingsReader(() => readSettingRows(db));
    const original = await reader.get(key);
    await updateSetting(db, actor, key, original + 1);
    reader.invalidate();
    expect(await reader.get(key)).toBe(original + 1);

    const [row] = await db.select().from(setting).where(eq(setting.key, key));
    expect(row?.updatedBy).toBe(actor);
    const [event] = await db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.entity, 'setting'), eq(auditEvent.actor, actor)))
      .orderBy(sql`${auditEvent.id} desc`)
      .limit(1);
    expect(event?.before).toMatchObject({ key, value: original });
    expect(event?.after).toMatchObject({ key, value: original + 1 });

    // Leave the value as the migration set it: other tests read it.
    await updateSetting(db, actor, key, original);
  });

  it('refuses a value of the wrong shape and changes nothing', async () => {
    const before = await readSettingRows(db);
    await expect(updateSetting(db, actor, key, -1)).rejects.toThrow();
    await expect(updateSetting(db, actor, 'nope.unknown' as typeof key, 1)).rejects.toThrow(
      SettingsError,
    );
    expect(await readSettingRows(db)).toEqual(before);
  });

  it('refuses a direct write that names no actor', async () => {
    await expect(
      db.update(setting).set({ value: 99 }).where(eq(setting.key, key)),
    ).rejects.toThrow();
  });

  it('refuses a malformed key', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('audit.actor', ${actor}, true)`);
        await tx.insert(setting).values({ key: 'NoArea', value: 1, updatedBy: actor });
      }),
    ).rejects.toThrow();
  });
});
