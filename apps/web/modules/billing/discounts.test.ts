import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { DiscountError, applyBillDiscount, removeBillDiscount } from './discounts';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  billCentre: vi.fn(),
  applyDiscount: vi.fn(),
  removeDiscount: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const lineId = '00000000-0000-4000-8000-000000000d01';
const presetId = '00000000-0000-4000-8000-000000000d02';
const staff = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000203',
  email: 'desk@clinicmx.test',
  name: 'Test Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const finance = staff({ role: 'finance', centreIds: [] });
const context = (actor = staff()) => ({ db: {} as Db, actor });
/** A refusal as drizzle passes on Postgres's. */
const refused = (message: string) =>
  Object.assign(new Error('Failed query'), { cause: { message } });
const other = { kind: 'percent', lineId, percent: '15', reason: 'Hardship' };

// BIL-07: the desk applies a preset at its centre; any other discount is Finance's or the Super
// Admin's, with a reason; the database's refusals reach them in plain words.
describe('discounts', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.billCentre.mockResolvedValue(hsr);
    db.applyDiscount.mockResolvedValue(67500);
    db.removeDiscount.mockResolvedValue(75000);
  });

  it('applies a preset at the desk’s centre, and nothing else of the desk’s', async () => {
    expect(await applyBillDiscount(context(), { kind: 'preset', lineId, presetId })).toBe(67500);
    expect(db.applyDiscount).toHaveBeenCalledWith(fakeTx, { lineId, presetId });
    expect(db.billCentre).toHaveBeenCalledWith(fakeTx, { lineId });
    await expect(applyBillDiscount(context(), other)).rejects.toThrow(NotAllowedError);
    db.billCentre.mockResolvedValue(koramangala);
    await expect(
      applyBillDiscount(context(), { kind: 'preset', lineId, presetId }),
    ).rejects.toThrow(NotAllowedError);
    for (const role of ['centre_manager', 'physiotherapist'] as const) {
      await expect(
        applyBillDiscount(context(staff({ role })), { kind: 'preset', lineId, presetId }),
      ).rejects.toThrow(NotAllowedError);
    }
    expect(db.applyDiscount).toHaveBeenCalledTimes(1);
  });

  it('lets Finance apply any discount with its reason, a percent or an amount', async () => {
    await applyBillDiscount(context(finance), other);
    expect(db.applyDiscount).toHaveBeenCalledWith(fakeTx, {
      lineId,
      presetId: null,
      percent: 15,
      amountPaise: null,
      reason: 'Hardship',
    });
    await applyBillDiscount(context(finance), {
      kind: 'flat',
      lineId,
      amount: '250',
      reason: 'Goodwill',
    });
    expect(db.applyDiscount).toHaveBeenLastCalledWith(fakeTx, {
      lineId,
      presetId: null,
      percent: null,
      amountPaise: 25000,
      reason: 'Goodwill',
    });
    await expect(applyBillDiscount(context(finance), { ...other, reason: '' })).rejects.toThrow(
      'Say why this discount is given.',
    );
  });

  it('says why the database refused, and removes a discount', async () => {
    const cases: [string, string][] = [
      [
        'Only an unpaid bill is discounted',
        'This bill is no longer unpaid, so its discount cannot change. Reload the page.',
      ],
      ['The discount would make the bill free', 'A discount cannot take the bill to ₹0.'],
      ['That discount is not in use', 'That discount is no longer in use. Choose another.'],
      ['Other discounts are applied by Finance', 'Only Finance changes this discount.'],
    ];
    for (const [cause, message] of cases) {
      db.applyDiscount.mockRejectedValueOnce(refused(cause));
      await expect(
        applyBillDiscount(context(), { kind: 'preset', lineId, presetId }),
      ).rejects.toThrow(new DiscountError(message));
    }
    expect(await removeBillDiscount(context(), { lineId })).toBe(75000);
    expect(db.removeDiscount).toHaveBeenCalledWith(fakeTx, lineId);
    db.billCentre.mockResolvedValue(undefined);
    await expect(removeBillDiscount(context(), { lineId })).rejects.toThrow(
      'That bill was not found.',
    );
  });
});
