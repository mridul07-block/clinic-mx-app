import type { DiscountPresetDetails, PackageTypeDetails } from '@clinic-mx/schemas';
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { discountPreset, packageType, packageTypeItem, priceItem } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The price master (SET-02): list prices, package types and preset discounts. Finance and the
 * Super Admin change them (prices.manage); Centre Managers and the front desk read them. Run under
 * row level security; every change is audited by the trigger, and nothing is deleted except a
 * package type's covered items, which are replaced.
 */

export interface PriceItemEntry {
  id: string;
  key: string;
  label: string;
  amountPaise: number;
  active: boolean;
}

export interface PackageTypeEntry {
  id: string;
  name: string;
  sessions: number;
  pricePaise: number;
  active: boolean;
  /** The covered price items, by label. */
  items: { id: string; label: string }[];
}

export type DiscountPresetEntry = {
  id: string;
  name: string;
  active: boolean;
} & ({ kind: 'percent'; percent: number } | { kind: 'flat'; amountPaise: number });

const itemColumns = {
  id: priceItem.id,
  key: priceItem.key,
  label: priceItem.label,
  amountPaise: priceItem.amountPaise,
  active: priceItem.active,
};

/** Whether another row of a table already has this name (any case). */
async function nameTaken(
  db: DbOrTransaction,
  table: typeof priceItem | typeof packageType | typeof discountPreset,
  column: PgColumn,
  id: PgColumn,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id })
    .from(table)
    .where(and(sql`lower(${column}) = lower(${name})`, exceptId ? ne(id, exceptId) : undefined));
  return Boolean(row);
}

const activeFirst = (active: PgColumn, name: PgColumn): SQL[] => [desc(active), asc(name)];

// Price items.

/** Every price item: active ones first, then by name. */
export function priceItemList(db: DbOrTransaction): Promise<PriceItemEntry[]> {
  return db
    .select(itemColumns)
    .from(priceItem)
    .orderBy(...activeFirst(priceItem.active, priceItem.label));
}

/** One price item, or undefined when it was not found. */
export async function priceItemRecord(
  db: DbOrTransaction,
  priceItemId: string,
): Promise<PriceItemEntry | undefined> {
  const [row] = await db.select(itemColumns).from(priceItem).where(eq(priceItem.id, priceItemId));
  return row;
}

/** Records a new, active price item under its key; returns its id. */
export async function insertPriceItem(
  db: DbOrTransaction,
  item: { key: string; label: string; amountPaise: number },
): Promise<string> {
  const [row] = await db.insert(priceItem).values(item).returning({ id: priceItem.id });
  if (!row) throw new Error('The price item was not recorded.');
  return row.id;
}

/** Changes a price item's name and amount (never its key); false when it was not found. */
export async function updatePriceItem(
  db: DbOrTransaction,
  priceItemId: string,
  details: { label: string; amountPaise: number },
): Promise<boolean> {
  const updated = await db
    .update(priceItem)
    .set({ ...details, updatedAt: sql`now()` })
    .where(eq(priceItem.id, priceItemId))
    .returning({ id: priceItem.id });
  return updated.length > 0;
}

/** Deactivates or reactivates a price item; false when it was not found or already so. */
export async function setPriceItemActive(
  db: DbOrTransaction,
  priceItemId: string,
  active: boolean,
): Promise<boolean> {
  const changed = await db
    .update(priceItem)
    .set({ active, updatedAt: sql`now()` })
    .where(and(eq(priceItem.id, priceItemId), ne(priceItem.active, active)))
    .returning({ id: priceItem.id });
  return changed.length > 0;
}

/** Whether another price item already has this name (any case). */
export function priceItemLabelTaken(
  db: DbOrTransaction,
  label: string,
  exceptId?: string,
): Promise<boolean> {
  return nameTaken(db, priceItem, priceItem.label, priceItem.id, label, exceptId);
}

/** Whether a price item already has this key. */
export async function priceItemKeyTaken(db: DbOrTransaction, key: string): Promise<boolean> {
  const [row] = await db.select({ id: priceItem.id }).from(priceItem).where(eq(priceItem.key, key));
  return Boolean(row);
}

// Package types.

const typeColumns = {
  id: packageType.id,
  name: packageType.name,
  sessions: packageType.sessions,
  pricePaise: packageType.pricePaise,
  active: packageType.active,
};

async function withItems(
  db: DbOrTransaction,
  types: Omit<PackageTypeEntry, 'items'>[],
): Promise<PackageTypeEntry[]> {
  if (types.length === 0) return [];
  const covered = await db
    .select({
      packageTypeId: packageTypeItem.packageTypeId,
      id: priceItem.id,
      label: priceItem.label,
    })
    .from(packageTypeItem)
    .innerJoin(priceItem, eq(priceItem.id, packageTypeItem.priceItemId))
    .where(
      inArray(
        packageTypeItem.packageTypeId,
        types.map((type) => type.id),
      ),
    )
    .orderBy(asc(priceItem.label));
  return types.map((type) => ({
    ...type,
    items: covered
      .filter((item) => item.packageTypeId === type.id)
      .map(({ id, label }) => ({ id, label })),
  }));
}

/** Every package type with what it covers: active ones first, then by name. */
export async function packageTypeList(db: DbOrTransaction): Promise<PackageTypeEntry[]> {
  const types = await db
    .select(typeColumns)
    .from(packageType)
    .orderBy(...activeFirst(packageType.active, packageType.name));
  return withItems(db, types);
}

/** One package type with what it covers, or undefined when it was not found. */
export async function packageTypeRecord(
  db: DbOrTransaction,
  packageTypeId: string,
): Promise<PackageTypeEntry | undefined> {
  const types = await db
    .select(typeColumns)
    .from(packageType)
    .where(eq(packageType.id, packageTypeId));
  const [type] = await withItems(db, types);
  return type;
}

async function coverItems(db: DbOrTransaction, packageTypeId: string, itemIds: string[]) {
  await db
    .insert(packageTypeItem)
    .values(itemIds.map((priceItemId) => ({ packageTypeId, priceItemId })));
}

/** Records a new, active package type and what it covers; returns its id. */
export async function insertPackageType(
  db: DbOrTransaction,
  details: PackageTypeDetails,
): Promise<string> {
  const [row] = await db
    .insert(packageType)
    .values({ name: details.name, sessions: details.sessions, pricePaise: details.price })
    .returning({ id: packageType.id });
  if (!row) throw new Error('The package type was not recorded.');
  await coverItems(db, row.id, details.itemIds);
  return row.id;
}

/**
 * Changes a package type and what it covers; only the items added or removed are written, so the
 * audit shows just those. False when it was not found.
 */
export async function updatePackageType(
  db: DbOrTransaction,
  packageTypeId: string,
  details: PackageTypeDetails,
): Promise<boolean> {
  const updated = await db
    .update(packageType)
    .set({
      name: details.name,
      sessions: details.sessions,
      pricePaise: details.price,
      updatedAt: sql`now()`,
    })
    .where(eq(packageType.id, packageTypeId))
    .returning({ id: packageType.id });
  if (updated.length === 0) return false;
  const current = await db
    .select({ priceItemId: packageTypeItem.priceItemId })
    .from(packageTypeItem)
    .where(eq(packageTypeItem.packageTypeId, packageTypeId));
  const had = new Set(current.map((row) => row.priceItemId));
  const wanted = new Set(details.itemIds);
  const removed = [...had].filter((id) => !wanted.has(id));
  const added = [...wanted].filter((id) => !had.has(id));
  if (removed.length > 0) {
    await db
      .delete(packageTypeItem)
      .where(
        and(
          eq(packageTypeItem.packageTypeId, packageTypeId),
          inArray(packageTypeItem.priceItemId, removed),
        ),
      );
  }
  if (added.length > 0) await coverItems(db, packageTypeId, added);
  return true;
}

/** Deactivates or reactivates a package type; false when it was not found or already so. */
export async function setPackageTypeActive(
  db: DbOrTransaction,
  packageTypeId: string,
  active: boolean,
): Promise<boolean> {
  const changed = await db
    .update(packageType)
    .set({ active, updatedAt: sql`now()` })
    .where(and(eq(packageType.id, packageTypeId), ne(packageType.active, active)))
    .returning({ id: packageType.id });
  return changed.length > 0;
}

/** Whether another package type already has this name (any case). */
export function packageTypeNameTaken(
  db: DbOrTransaction,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  return nameTaken(db, packageType, packageType.name, packageType.id, name, exceptId);
}

// Preset discounts.

const discountColumns = {
  id: discountPreset.id,
  name: discountPreset.name,
  active: discountPreset.active,
  kind: discountPreset.kind,
  percent: discountPreset.percent,
  amountPaise: discountPreset.amountPaise,
};

type DiscountRow = {
  id: string;
  name: string;
  active: boolean;
  kind: 'percent' | 'flat';
  percent: number | null;
  amountPaise: number | null;
};

/** The table's check guarantees the field the kind needs is set. */
function discountEntry({ percent, amountPaise, ...row }: DiscountRow): DiscountPresetEntry {
  return row.kind === 'percent'
    ? { ...row, kind: 'percent', percent: percent ?? 0 }
    : { ...row, kind: 'flat', amountPaise: amountPaise ?? 0 };
}

const discountValues = (details: DiscountPresetDetails) => ({
  name: details.name,
  kind: details.kind,
  percent: details.kind === 'percent' ? details.percent : null,
  amountPaise: details.kind === 'flat' ? details.amount : null,
});

/** Every preset discount: active ones first, then by name. */
export async function discountPresetList(db: DbOrTransaction): Promise<DiscountPresetEntry[]> {
  const rows = await db
    .select(discountColumns)
    .from(discountPreset)
    .orderBy(...activeFirst(discountPreset.active, discountPreset.name));
  return rows.map(discountEntry);
}

/** One preset discount, or undefined when it was not found. */
export async function discountPresetRecord(
  db: DbOrTransaction,
  discountPresetId: string,
): Promise<DiscountPresetEntry | undefined> {
  const [row] = await db
    .select(discountColumns)
    .from(discountPreset)
    .where(eq(discountPreset.id, discountPresetId));
  return row && discountEntry(row);
}

/** Records a new, active preset discount; returns its id. */
export async function insertDiscountPreset(
  db: DbOrTransaction,
  details: DiscountPresetDetails,
): Promise<string> {
  const [row] = await db
    .insert(discountPreset)
    .values(discountValues(details))
    .returning({ id: discountPreset.id });
  if (!row) throw new Error('The discount was not recorded.');
  return row.id;
}

/** Changes a preset discount; false when it was not found. */
export async function updateDiscountPreset(
  db: DbOrTransaction,
  discountPresetId: string,
  details: DiscountPresetDetails,
): Promise<boolean> {
  const updated = await db
    .update(discountPreset)
    .set({ ...discountValues(details), updatedAt: sql`now()` })
    .where(eq(discountPreset.id, discountPresetId))
    .returning({ id: discountPreset.id });
  return updated.length > 0;
}

/** Deactivates or reactivates a preset discount; false when it was not found or already so. */
export async function setDiscountPresetActive(
  db: DbOrTransaction,
  discountPresetId: string,
  active: boolean,
): Promise<boolean> {
  const changed = await db
    .update(discountPreset)
    .set({ active, updatedAt: sql`now()` })
    .where(and(eq(discountPreset.id, discountPresetId), ne(discountPreset.active, active)))
    .returning({ id: discountPreset.id });
  return changed.length > 0;
}

/** Whether another preset discount already has this name (any case). */
export function discountPresetNameTaken(
  db: DbOrTransaction,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  return nameTaken(db, discountPreset, discountPreset.name, discountPreset.id, name, exceptId);
}
