import 'server-only';
import {
  discountPresetNameTaken,
  discountPresetRecord,
  insertDiscountPreset,
  insertPackageType,
  insertPriceItem,
  packageTypeNameTaken,
  packageTypeRecord,
  priceItemKeyTaken,
  priceItemLabelTaken,
  priceItemList,
  priceItemRecord,
  setDiscountPresetActive,
  setPackageTypeActive,
  setPriceItemActive,
  updateDiscountPreset,
  updatePackageType,
  updatePriceItem,
} from '@clinic-mx/db';
import {
  discountPresetActiveSchema,
  discountPresetDetailsSchema,
  discountPresetUpdateSchema,
  packageTypeActiveSchema,
  packageTypeDetailsSchema,
  packageTypeUpdateSchema,
  priceItemActiveSchema,
  priceItemDetailsSchema,
  priceItemKey,
  priceItemUpdateSchema,
} from '@clinic-mx/schemas';
import { staffService, type ServiceTransaction } from '../access/service';

/**
 * The price master (SET-02, PRD section 7): list prices, package types and preset discounts.
 * Finance and the Super Admin keep it (prices.manage); each change is a staffService under row
 * level security and audited. Nothing is deleted; items are deactivated. Bills copy prices when
 * they are made (BIL-05), so a change here never alters a bill already made.
 */

/** A refusal to show as it is. */
export class PriceError extends Error {
  override name = 'PriceError';
}

const already = (active: boolean, what: string) =>
  new PriceError(active ? `That ${what} is already active.` : `That ${what} is already inactive.`);

/** Adds a price item, active from now, under a key made from its name. */
export const addPriceItem = staffService({
  action: 'prices.manage',
  input: priceItemDetailsSchema,
  run: async (tx, { label, amount }) => {
    if (await priceItemLabelTaken(tx, label)) {
      throw new PriceError('A price item with this name already exists.');
    }
    const key = priceItemKey(label);
    if (await priceItemKeyTaken(tx, key)) {
      throw new PriceError(
        'Another price item has a name too close to this one. Choose a different name.',
      );
    }
    return insertPriceItem(tx, { key, label, amountPaise: amount });
  },
});

/** Changes a price item's name or amount; its key stays as it was. */
export const editPriceItem = staffService({
  action: 'prices.manage',
  input: priceItemUpdateSchema,
  run: async (tx, { priceItemId, label, amount }) => {
    if (!(await priceItemRecord(tx, priceItemId))) {
      throw new PriceError('That price item was not found.');
    }
    if (await priceItemLabelTaken(tx, label, priceItemId)) {
      throw new PriceError('A price item with this name already exists.');
    }
    await updatePriceItem(tx, priceItemId, { label, amountPaise: amount });
  },
});

export const setPriceItemActiveService = staffService({
  action: 'prices.manage',
  input: priceItemActiveSchema,
  run: async (tx, { priceItemId, active }) => {
    if (!(await priceItemRecord(tx, priceItemId))) {
      throw new PriceError('That price item was not found.');
    }
    if (!(await setPriceItemActive(tx, priceItemId, active))) throw already(active, 'price item');
  },
});

/**
 * Every covered item must be a price item; one newly added must be active. An item already
 * covered may stay after it is deactivated.
 */
async function checkCovered(tx: ServiceTransaction, itemIds: string[], kept: string[] = []) {
  const items = new Map((await priceItemList(tx)).map((item) => [item.id, item]));
  for (const id of itemIds) {
    const item = items.get(id);
    if (!item) throw new PriceError('One of the chosen price items was not found.');
    if (!item.active && !kept.includes(id)) {
      throw new PriceError(`${item.label} is inactive. Choose active price items only.`);
    }
  }
}

/** Adds a package type, active from now. */
export const addPackageType = staffService({
  action: 'prices.manage',
  input: packageTypeDetailsSchema,
  run: async (tx, details) => {
    if (await packageTypeNameTaken(tx, details.name)) {
      throw new PriceError('A package type with this name already exists.');
    }
    await checkCovered(tx, details.itemIds);
    return insertPackageType(tx, details);
  },
});

/** Changes a package type's name, sessions, price or what it covers. */
export const editPackageType = staffService({
  action: 'prices.manage',
  input: packageTypeUpdateSchema,
  run: async (tx, { packageTypeId, ...details }) => {
    const current = await packageTypeRecord(tx, packageTypeId);
    if (!current) throw new PriceError('That package type was not found.');
    if (await packageTypeNameTaken(tx, details.name, packageTypeId)) {
      throw new PriceError('A package type with this name already exists.');
    }
    await checkCovered(
      tx,
      details.itemIds,
      current.items.map((item) => item.id),
    );
    await updatePackageType(tx, packageTypeId, details);
  },
});

export const setPackageTypeActiveService = staffService({
  action: 'prices.manage',
  input: packageTypeActiveSchema,
  run: async (tx, { packageTypeId, active }) => {
    if (!(await packageTypeRecord(tx, packageTypeId))) {
      throw new PriceError('That package type was not found.');
    }
    if (!(await setPackageTypeActive(tx, packageTypeId, active))) {
      throw already(active, 'package type');
    }
  },
});

/** Adds a preset discount, active from now. */
export const addDiscountPreset = staffService({
  action: 'prices.manage',
  input: discountPresetDetailsSchema,
  run: async (tx, details) => {
    if (await discountPresetNameTaken(tx, details.name)) {
      throw new PriceError('A discount with this name already exists.');
    }
    return insertDiscountPreset(tx, details);
  },
});

/** Changes a preset discount's name, kind or amount. */
export const editDiscountPreset = staffService({
  action: 'prices.manage',
  input: discountPresetUpdateSchema,
  run: async (tx, { discountPresetId, ...details }) => {
    if (!(await discountPresetRecord(tx, discountPresetId))) {
      throw new PriceError('That discount was not found.');
    }
    if (await discountPresetNameTaken(tx, details.name, discountPresetId)) {
      throw new PriceError('A discount with this name already exists.');
    }
    await updateDiscountPreset(tx, discountPresetId, details);
  },
});

export const setDiscountPresetActiveService = staffService({
  action: 'prices.manage',
  input: discountPresetActiveSchema,
  run: async (tx, { discountPresetId, active }) => {
    if (!(await discountPresetRecord(tx, discountPresetId))) {
      throw new PriceError('That discount was not found.');
    }
    if (!(await setDiscountPresetActive(tx, discountPresetId, active))) {
      throw already(active, 'discount');
    }
  },
});
