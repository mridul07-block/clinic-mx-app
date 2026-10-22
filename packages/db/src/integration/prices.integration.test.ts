import { settingDefinitions } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  discountPresetList,
  insertDiscountPreset,
  insertPackageType,
  insertPriceItem,
  packageTypeRecord,
  priceItemList,
  updatePackageType,
  updatePriceItem,
} from '../prices';
import { auditEvent, discountPreset, priceItem, setting } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';

// SET-02 done when: Finance and Super Admin edit; changes audited. Centre Managers and the front
// desk read prices; physiotherapists see none. Every test runs in a transaction that is rolled
// back, so the seeded prices never change. CI only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string, extra: Partial<StaffMember> = {}): StaffMember {
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
    ...extra,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const finance = member('finance@clinicmx.test');
const manager = member('manager@clinicmx.test');
const desk = member('desk.hsr@clinicmx.test');
const physio = member('physio.hsr@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

/** Runs `work` as a staff member under RLS, in a transaction that is always rolled back. */
async function rolledBack(actor: StaffMember, work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withStaffAccess(db, { actor }, async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** The Postgres error code a statement failed with, inside a savepoint. */
async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

/**
 * Reads as the database owner inside the person's transaction (the audit trail is the Super
 * Admin's to read), then goes back to their role.
 */
async function asOwner<R>(tx: Tx, read: () => Promise<R>): Promise<R> {
  await tx.execute(sql`reset role`);
  const result = await read();
  await tx.execute(sql`set local role authenticated`);
  return result;
}

const keyOf = (items: { key: string; amountPaise: number }[], key: string) =>
  items.find((item) => item.key === key);

describe('the price master', () => {
  it('starts with the PRD’s eight prices, in paise', async () => {
    await rolledBack(finance, async (tx) => {
      const items = await priceItemList(tx);
      expect(
        Object.fromEntries(
          [
            'consultation',
            'senior_consultation',
            'rehabilitation_session',
            'advanced_rehabilitation_session',
            'pemf',
            'radial_shockwave',
            'focused_shockwave',
            'zero_gravity_treadmill',
          ].map((key) => [key, keyOf(items, key)?.amountPaise]),
        ),
      ).toEqual({
        consultation: 75000,
        senior_consultation: 100000,
        rehabilitation_session: 100000,
        advanced_rehabilitation_session: 150000,
        pemf: 75000,
        radial_shockwave: 75000,
        focused_shockwave: 200000,
        zero_gravity_treadmill: 200000,
      });
    });
  });

  it('has every price item the package settings name', async () => {
    const [row] = await db
      .select({ value: setting.value })
      .from(setting)
      .where(eq(setting.key, 'packages.never_reschedulable_items'));
    const keys = settingDefinitions['packages.never_reschedulable_items'].schema.parse(row?.value);
    const known = new Set(
      (await db.select({ key: priceItem.key }).from(priceItem)).map((r) => r.key),
    );
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(known.has(key), key).toBe(true);
  });

  it('is read by Centre Managers and the front desk, and by no physiotherapist', async () => {
    for (const person of [superAdmin, finance, manager, desk]) {
      await rolledBack(person, async (tx) => {
        expect((await priceItemList(tx)).length, person.email).toBeGreaterThanOrEqual(8);
      });
    }
    await rolledBack(physio, async (tx) => {
      expect(await priceItemList(tx)).toEqual([]);
      expect(await discountPresetList(tx)).toEqual([]);
    });
  });

  it('is changed by Finance and the Super Admin, and every change is audited as them', async () => {
    for (const person of [finance, superAdmin]) {
      await rolledBack(person, async (tx) => {
        const pemf = keyOf(await priceItemList(tx), 'pemf') as { id: string } | undefined;
        if (!pemf) throw new Error('no pemf');
        expect(await updatePriceItem(tx, pemf.id, { label: 'PEMF', amountPaise: 80000 })).toBe(
          true,
        );
        const [event] = await asOwner(tx, () =>
          tx
            .select({ actor: auditEvent.actor, action: auditEvent.action, after: auditEvent.after })
            .from(auditEvent)
            .where(and(eq(auditEvent.entity, 'price_item'), eq(auditEvent.entityId, pemf.id)))
            .orderBy(desc(auditEvent.id))
            .limit(1),
        );
        expect(event?.actor).toBe(`staff:${person.id}`);
        expect(event?.action).toBe('update');
        expect((event?.after as { amount_paise: number }).amount_paise).toBe(80000);

        const laser = await insertPriceItem(tx, {
          key: 'test_laser',
          label: 'Test laser',
          amountPaise: 120000,
        });
        const type = await insertPackageType(tx, {
          name: 'Test package',
          sessions: 10,
          price: 900000,
          itemIds: [pemf.id, laser],
        });
        expect((await packageTypeRecord(tx, type))?.items.map((i) => i.label)).toEqual([
          'PEMF',
          'Test laser',
        ]);
        // Replacing what it covers removes and adds only the difference.
        await updatePackageType(tx, type, {
          name: 'Test package',
          sessions: 12,
          price: 1000000,
          itemIds: [laser],
        });
        expect((await packageTypeRecord(tx, type))?.items.map((i) => i.id)).toEqual([laser]);
        const coverEvents = await asOwner(tx, () =>
          tx
            .select({ action: auditEvent.action })
            .from(auditEvent)
            .where(
              and(
                eq(auditEvent.entity, 'package_type_item'),
                sql`(${auditEvent.after}->>'package_type_id' = ${type}
                  or ${auditEvent.before}->>'package_type_id' = ${type})`,
              ),
            ),
        );
        expect(coverEvents.map((e) => e.action).sort()).toEqual(['delete', 'insert', 'insert']);
        await insertDiscountPreset(tx, { name: 'Test runners', kind: 'percent', percent: 10 });
        await insertDiscountPreset(tx, { name: 'Test doctors', kind: 'flat', amount: 50000 });
        expect((await discountPresetList(tx)).filter((d) => d.name.startsWith('Test '))).toEqual([
          expect.objectContaining({ name: 'Test doctors', kind: 'flat', amountPaise: 50000 }),
          expect.objectContaining({ name: 'Test runners', kind: 'percent', percent: 10 }),
        ]);
      });
    }
  });

  it('is not changed by anyone else, nor by Velyx support', async () => {
    for (const person of [manager, desk, physio, support]) {
      // Support's transactions are read only (IAM-08), before any policy is asked.
      const refused = person.support ? '25006' : '42501';
      await rolledBack(person, async (tx) => {
        expect(
          await failure(tx, (sp) =>
            insertPriceItem(sp, { key: 'test_laser', label: 'Test laser', amountPaise: 120000 }),
          ),
          person.email,
        ).toBe(refused);
        expect(
          await failure(tx, (sp) =>
            insertDiscountPreset(sp, { name: 'Test runners', kind: 'percent', percent: 10 }),
          ),
          person.email,
        ).toBe(refused);
        // An update matches no row it may change.
        expect(
          await failure(tx, (sp) =>
            sp.update(priceItem).set({ amountPaise: 1 }).where(eq(priceItem.key, 'pemf')),
          ),
          person.email,
        ).toBe(person.support ? '25006' : undefined);
        const [pemf] = await asOwner(tx, () =>
          tx
            .select({ amountPaise: priceItem.amountPaise })
            .from(priceItem)
            .where(eq(priceItem.key, 'pemf')),
        );
        expect(pemf?.amountPaise, person.email).toBe(75000);
      });
    }
  });

  it('refuses bad amounts, a discount with the wrong field, names in use, and deletes', async () => {
    await rolledBack(finance, async (tx) => {
      expect(
        await failure(tx, (sp) =>
          insertPriceItem(sp, { key: 'test_free', label: 'Free', amountPaise: 0 }),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          insertPriceItem(sp, { key: 'test_pemf', label: 'pemf', amountPaise: 100 }),
        ),
      ).toBe('23505');
      expect(
        await failure(tx, (sp) =>
          sp
            .insert(discountPreset)
            .values({ name: 'Both', kind: 'percent', percent: 10, amountPaise: 100 }),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp.insert(discountPreset).values({ name: 'Too much', kind: 'percent', percent: 101 }),
        ),
      ).toBe('23514');
      // No delete policy on price items: nothing matches, nothing goes.
      const deleted = await tx
        .delete(priceItem)
        .where(eq(priceItem.key, 'pemf'))
        .returning({ id: priceItem.id });
      expect(deleted).toEqual([]);
    });
  });
});
