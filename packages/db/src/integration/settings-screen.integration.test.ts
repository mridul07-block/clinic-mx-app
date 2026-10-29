import {
  parseSettingField,
  settingChangedElsewhere,
  settingFieldText,
  settingKeys,
} from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { staffActor, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { auditEvent } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';
import { changeSettingValue, lockSettings, settingEntries } from '../settings';
import { becomeStaff } from './fake-schedule';

// ADM-02 done when: the Super Admin reads and changes each business rule setting, validated and
// audited, on the value read. Nobody else changes one. Rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const finance = member('finance@clinicmx.test');
const manager = member('manager@clinicmx.test');
const desk = member('desk.hsr@clinicmx.test');
const physio = member('physio.hsr@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('tests'), async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function asOwner(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

const key = 'day.running_late_minutes';

describe('the settings screen', () => {
  it('lets the Super Admin read every setting and change one on the value read', async () => {
    await rolledBack(async (tx) => {
      await becomeStaff(tx, superAdmin);
      const entries = await settingEntries(tx);
      expect(entries.map((entry) => entry.key).sort()).toEqual([...settingKeys].sort());
      const read = entries.find((entry) => entry.key === key);
      if (!read) throw new Error('no setting');

      const actor = staffActor(superAdmin.id);
      // A change time other than the one read: refused, nothing written.
      const stale = new Date(read.updatedAt.getTime() - 1000);
      expect(await changeSettingValue(tx, { key, value: 20, actor, seenAt: stale })).toBe('stale');
      // The value already there writes nothing.
      expect(
        await changeSettingValue(tx, { key, value: read.value, actor, seenAt: read.updatedAt }),
      ).toBe('unchanged');
      await lockSettings(tx);
      expect(await changeSettingValue(tx, { key, value: 20, actor, seenAt: read.updatedAt })).toBe(
        'saved',
      );
      const after = (await settingEntries(tx)).find((entry) => entry.key === key);
      expect(after).toMatchObject({ value: 20, updatedBy: actor, updatedByName: superAdmin.name });
      // The value read before is no longer current.
      expect(await changeSettingValue(tx, { key, value: 25, actor, seenAt: read.updatedAt })).toBe(
        'stale',
      );
      // A value the registry refuses never reaches the table.
      await expect(
        changeSettingValue(tx, { key, value: -1, actor, seenAt: after?.updatedAt ?? new Date() }),
      ).rejects.toThrow();

      await asOwner(tx);
      const [audited] = await tx
        .select({ actor: auditEvent.actor, before: auditEvent.before, after: auditEvent.after })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'setting'), sql`${auditEvent.after} ->> 'key' = ${key}`))
        .orderBy(desc(auditEvent.id))
        .limit(1);
      expect(audited).toMatchObject({
        actor,
        before: { value: read.value },
        after: { value: 20 },
      });
    });
  });

  it('shows every stored value in a field that saves it back unchanged', async () => {
    const entries = await settingEntries(db);
    const current = Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
    for (const { key: each, value } of entries) {
      if (!settingKeys.includes(each as (typeof settingKeys)[number])) continue;
      const typed = each as (typeof settingKeys)[number];
      if (settingChangedElsewhere(typed)) continue;
      expect(parseSettingField(typed, settingFieldText(typed, value), current), each).toEqual({
        ok: true,
        value,
      });
    }
  });

  it('lets nobody else read or change a setting', async () => {
    await rolledBack(async (tx) => {
      for (const who of [finance, manager, desk, physio]) {
        await becomeStaff(tx, who);
        expect(await settingEntries(tx)).toEqual([]);
        expect(
          await changeSettingValue(tx, {
            key,
            value: 20,
            actor: staffActor(who.id),
            seenAt: new Date(),
          }),
        ).toBe('stale');
        await asOwner(tx);
      }
    });
  });
});
