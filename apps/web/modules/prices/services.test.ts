import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import {
  PriceError,
  addDiscountPreset,
  addPackageType,
  addPriceItem,
  editDiscountPreset,
  editPackageType,
  editPriceItem,
  setDiscountPresetActiveService,
  setPackageTypeActiveService,
  setPriceItemActiveService,
} from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  discountPresetNameTaken: vi.fn(),
  discountPresetRecord: vi.fn(),
  insertDiscountPreset: vi.fn(),
  insertPackageType: vi.fn(),
  insertPriceItem: vi.fn(),
  packageTypeNameTaken: vi.fn(),
  packageTypeRecord: vi.fn(),
  priceItemKeyTaken: vi.fn(),
  priceItemLabelTaken: vi.fn(),
  priceItemList: vi.fn(),
  priceItemRecord: vi.fn(),
  setDiscountPresetActive: vi.fn(),
  setPackageTypeActive: vi.fn(),
  setPriceItemActive: vi.fn(),
  updateDiscountPreset: vi.fn(),
  updatePackageType: vi.fn(),
  updatePriceItem: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const rehab = '00000000-0000-4000-8000-000000000301';
const pemf = '00000000-0000-4000-8000-000000000302';
const laser = '00000000-0000-4000-8000-000000000303';
const typeId = '00000000-0000-4000-8000-000000000401';
const discountId = '00000000-0000-4000-8000-000000000501';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000201',
  email: 'finance@clinicmx.test',
  name: 'Test Finance',
  role: 'finance',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
  ...extra,
});
const context = (actor = member()) => ({ db: {} as Db, actor });
const item = (id: string, label: string, active = true) => ({
  id,
  key: label.toLowerCase(),
  label,
  amountPaise: 100000,
  active,
});
const pack = {
  name: '10 rehabilitation sessions',
  sessions: '10',
  price: '9,000',
  itemIds: [rehab],
};

// SET-02 done when: Finance and Super Admin edit; changes audited (by the trigger, under RLS).
describe('price master', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.priceItemLabelTaken.mockResolvedValue(false);
    db.priceItemKeyTaken.mockResolvedValue(false);
    db.packageTypeNameTaken.mockResolvedValue(false);
    db.discountPresetNameTaken.mockResolvedValue(false);
    db.insertPriceItem.mockResolvedValue(laser);
    db.insertPackageType.mockResolvedValue(typeId);
    db.insertDiscountPreset.mockResolvedValue(discountId);
    db.priceItemRecord.mockResolvedValue(item(pemf, 'PEMF'));
    db.priceItemList.mockResolvedValue([
      item(rehab, 'Rehabilitation session'),
      item(pemf, 'PEMF'),
      item(laser, 'Laser', false),
    ]);
    db.packageTypeRecord.mockResolvedValue({
      id: typeId,
      name: pack.name,
      sessions: 10,
      pricePaise: 900000,
      active: true,
      items: [{ id: laser, label: 'Laser' }],
    });
    db.discountPresetRecord.mockResolvedValue({
      id: discountId,
      name: 'Runners',
      kind: 'percent',
      percent: 10,
      active: true,
    });
    for (const fn of [db.setPriceItemActive, db.setPackageTypeActive, db.setDiscountPresetActive]) {
      fn.mockResolvedValue(true);
    }
  });

  it('is for Finance and the Super Admin; read only for Velyx support', async () => {
    expect(await addPriceItem(context(), { label: 'Laser', amount: '1,200' })).toBe(laser);
    expect(
      await addPriceItem(context(member({ role: 'super_admin' })), {
        label: 'Laser',
        amount: '1200',
      }),
    ).toBe(laser);
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist'] as const) {
      const someone = context(member({ role }));
      await expect(addPriceItem(someone, { label: 'Laser', amount: '1200' })).rejects.toThrow(
        NotAllowedError,
      );
      await expect(addPackageType(someone, pack)).rejects.toThrow(NotAllowedError);
      await expect(
        addDiscountPreset(someone, { name: 'Runners', kind: 'percent', percent: '10' }),
      ).rejects.toThrow(NotAllowedError);
    }
    const support = context(member({ role: 'super_admin', support: true }));
    await expect(addPriceItem(support, { label: 'Laser', amount: '1200' })).rejects.toThrow(
      ReadOnlyError,
    );
    expect(db.insertPriceItem).toHaveBeenCalledTimes(2);
    expect(db.insertPackageType).not.toHaveBeenCalled();
    expect(db.insertDiscountPreset).not.toHaveBeenCalled();
  });

  it('adds a price item in paise under a key made from its name', async () => {
    await addPriceItem(context(), { label: ' Dry needling ', amount: '₹1,000' });
    expect(db.insertPriceItem).toHaveBeenCalledWith(fakeTx, {
      key: 'dry_needling',
      label: 'Dry needling',
      amountPaise: 100000,
    });
  });

  it('refuses a name in use, a key in use and a bad amount', async () => {
    db.priceItemLabelTaken.mockResolvedValueOnce(true);
    await expect(addPriceItem(context(), { label: 'PEMF', amount: '750' })).rejects.toThrow(
      'A price item with this name already exists.',
    );
    db.priceItemKeyTaken.mockResolvedValueOnce(true);
    await expect(addPriceItem(context(), { label: 'P.E.M.F', amount: '750' })).rejects.toThrow(
      PriceError,
    );
    await expect(addPriceItem(context(), { label: 'PEMF', amount: '0' })).rejects.toThrow(
      z.ZodError,
    );
    expect(db.insertPriceItem).not.toHaveBeenCalled();
  });

  it('edits a price item’s name and amount, never its key', async () => {
    await editPriceItem(context(), { priceItemId: pemf, label: 'PEMF', amount: '800' });
    expect(db.priceItemLabelTaken).toHaveBeenCalledWith(fakeTx, 'PEMF', pemf);
    expect(db.updatePriceItem).toHaveBeenCalledWith(fakeTx, pemf, {
      label: 'PEMF',
      amountPaise: 80000,
    });
    db.priceItemRecord.mockResolvedValueOnce(undefined);
    await expect(
      editPriceItem(context(), { priceItemId: pemf, label: 'PEMF', amount: '800' }),
    ).rejects.toThrow('not found');
  });

  it('adds a package type covering active price items', async () => {
    expect(await addPackageType(context(), { ...pack, itemIds: [rehab, pemf] })).toBe(typeId);
    expect(db.insertPackageType).toHaveBeenCalledWith(fakeTx, {
      name: pack.name,
      sessions: 10,
      price: 900000,
      itemIds: [rehab, pemf],
    });
    await expect(addPackageType(context(), { ...pack, itemIds: [laser] })).rejects.toThrow(
      'Laser is inactive. Choose active price items only.',
    );
    await expect(
      addPackageType(context(), { ...pack, itemIds: ['00000000-0000-4000-8000-000000000399'] }),
    ).rejects.toThrow('not found');
    await expect(addPackageType(context(), { ...pack, itemIds: [] })).rejects.toThrow(z.ZodError);
    db.packageTypeNameTaken.mockResolvedValueOnce(true);
    await expect(addPackageType(context(), pack)).rejects.toThrow('already exists');
    expect(db.insertPackageType).toHaveBeenCalledTimes(1);
  });

  it('lets a package keep an item that was deactivated after it was added', async () => {
    await editPackageType(context(), { packageTypeId: typeId, ...pack, itemIds: [laser, rehab] });
    expect(db.updatePackageType).toHaveBeenCalledWith(fakeTx, typeId, {
      name: pack.name,
      sessions: 10,
      price: 900000,
      itemIds: [laser, rehab],
    });
  });

  it('adds and edits a percent or a flat discount', async () => {
    await addDiscountPreset(context(), { name: 'Runners', kind: 'percent', percent: '10' });
    expect(db.insertDiscountPreset).toHaveBeenCalledWith(fakeTx, {
      name: 'Runners',
      kind: 'percent',
      percent: 10,
    });
    await editDiscountPreset(context(), {
      discountPresetId: discountId,
      name: 'Runners',
      kind: 'flat',
      amount: '250',
    });
    expect(db.updateDiscountPreset).toHaveBeenCalledWith(fakeTx, discountId, {
      name: 'Runners',
      kind: 'flat',
      amount: 25000,
    });
    await expect(
      addDiscountPreset(context(), { name: 'Runners', kind: 'percent', percent: '150' }),
    ).rejects.toThrow(z.ZodError);
    db.discountPresetNameTaken.mockResolvedValueOnce(true);
    await expect(
      addDiscountPreset(context(), { name: 'Runners', kind: 'flat', amount: '100' }),
    ).rejects.toThrow('A discount with this name already exists.');
  });

  it('deactivates and reactivates once each', async () => {
    await setPriceItemActiveService(context(), { priceItemId: pemf, active: false });
    expect(db.setPriceItemActive).toHaveBeenCalledWith(fakeTx, pemf, false);
    await setPackageTypeActiveService(context(), { packageTypeId: typeId, active: false });
    expect(db.setPackageTypeActive).toHaveBeenCalledWith(fakeTx, typeId, false);
    await setDiscountPresetActiveService(context(), { discountPresetId: discountId, active: true });
    expect(db.setDiscountPresetActive).toHaveBeenCalledWith(fakeTx, discountId, true);
    db.setPriceItemActive.mockResolvedValueOnce(false);
    await expect(
      setPriceItemActiveService(context(), { priceItemId: pemf, active: false }),
    ).rejects.toThrow('That price item is already inactive.');
    db.packageTypeRecord.mockResolvedValueOnce(undefined);
    await expect(
      setPackageTypeActiveService(context(), { packageTypeId: typeId, active: true }),
    ).rejects.toThrow('not found');
  });
});
