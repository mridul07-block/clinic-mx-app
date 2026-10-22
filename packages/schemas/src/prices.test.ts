import { describe, expect, it } from 'vitest';
import {
  discountPresetDetailsSchema,
  discountPresetUpdateSchema,
  packageTypeDetailsSchema,
  priceItemDetailsSchema,
  priceItemKey,
} from './prices';
import { settingDefinitions } from './settings';

const item1 = '00000000-0000-4000-8000-000000000301';
const item2 = '00000000-0000-4000-8000-000000000302';

// SET-02: the price master, package types and preset discounts.
describe('price master', () => {
  it('takes a price item’s name and amount in rupees', () => {
    expect(priceItemDetailsSchema.parse({ label: ' PEMF ', amount: '750' })).toEqual({
      label: 'PEMF',
      amount: 75000,
    });
    expect(priceItemDetailsSchema.safeParse({ label: '', amount: '750' }).success).toBe(false);
    expect(priceItemDetailsSchema.safeParse({ label: '123', amount: '750' }).success).toBe(false);
    expect(priceItemDetailsSchema.safeParse({ label: 'PEMF', amount: '0' }).success).toBe(false);
  });

  it('makes a stable key from the name, the kind settings refer to', () => {
    expect(priceItemKey('Zero Gravity Treadmill')).toBe('zero_gravity_treadmill');
    expect(priceItemKey('Radial shockwave (RSW)')).toBe('radial_shockwave_rsw');
    expect(priceItemKey('  Laser – Class IV ')).toBe('laser_class_iv');
    expect(priceItemKey('3D gait scan')).toBe('item_3d_gait_scan');
    const keyRule = settingDefinitions['packages.never_reschedulable_items'].schema;
    for (const label of ['Zero Gravity Treadmill', '3D gait scan', 'x'.repeat(80)]) {
      expect(keyRule.safeParse([priceItemKey(label)]).success, label).toBe(true);
    }
  });

  it('takes a package type’s sessions, price and what it covers', () => {
    expect(
      packageTypeDetailsSchema.parse({
        name: '10 rehabilitation sessions',
        sessions: '10',
        price: '9,000',
        itemIds: [item1, item2, item1],
      }),
    ).toEqual({
      name: '10 rehabilitation sessions',
      sessions: 10,
      price: 900000,
      itemIds: [item1, item2],
    });
    const good = { name: 'Ten', sessions: '10', price: '9000', itemIds: [item1] };
    for (const bad of [
      { sessions: '0' },
      { sessions: '2.5' },
      { sessions: '1000' },
      { sessions: '' },
      { price: '' },
      { itemIds: [] },
      { itemIds: ['not an id'] },
    ]) {
      expect(
        packageTypeDetailsSchema.safeParse({ ...good, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it('takes a discount as a whole percent or a flat amount, never both', () => {
    expect(
      discountPresetDetailsSchema.parse({
        name: 'Runners',
        kind: 'percent',
        percent: '10',
        amount: '',
      }),
    ).toEqual({ name: 'Runners', kind: 'percent', percent: 10 });
    expect(
      discountPresetDetailsSchema.parse({
        name: 'Doctors',
        kind: 'flat',
        amount: '500',
        percent: '',
      }),
    ).toEqual({ name: 'Doctors', kind: 'flat', amount: 50000 });
    for (const bad of [
      { kind: 'percent', percent: '0' },
      { kind: 'percent', percent: '101' },
      { kind: 'percent', percent: '12.5' },
      { kind: 'flat', amount: '0' },
      { kind: 'flat', percent: '10' },
      { kind: '' },
    ]) {
      expect(
        discountPresetDetailsSchema.safeParse({ name: 'Runners', ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
    expect(
      discountPresetUpdateSchema.parse({
        discountPresetId: item1,
        name: 'Runners',
        kind: 'percent',
        percent: '15',
      }),
    ).toEqual({ discountPresetId: item1, name: 'Runners', kind: 'percent', percent: 15 });
  });
});
