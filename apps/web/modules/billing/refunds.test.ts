import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { RefundError, refundBillPayment, refundsView } from './refunds';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  billCentre: vi.fn(),
  refundPayment: vi.fn(),
  refundablePayment: vi.fn(),
  refundHistory: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const paymentId = '00000000-0000-4000-8000-000000000c01';
const staff = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000202',
  email: 'finance@clinicmx.test',
  name: 'Test Finance',
  role: 'finance',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
  ...extra,
});
const context = (actor = staff()) => ({ db: {} as Db, actor });
const refused = (message: string) =>
  Object.assign(new Error('Failed query'), { cause: { message } });
const refund = { paymentId, amount: '500', method: 'upi', reason: 'Moved away' };

// BIL-11: Finance and the Super Admin record refunds; the desk, the Centre Manager, a physio and
// Velyx support never do; the database's refusals reach Finance in plain words.
describe('refunds', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.billCentre.mockResolvedValue(hsr);
    db.refundPayment.mockResolvedValue('refund');
    db.refundHistory.mockResolvedValue([]);
  });

  it('records the amount in paise, the method, the reason, for Finance and the Super Admin', async () => {
    expect(await refundBillPayment(context(), refund)).toBe('refund');
    expect(db.refundPayment).toHaveBeenCalledWith(fakeTx, {
      paymentId,
      amountPaise: 50000,
      method: 'upi',
      reference: undefined,
      reason: 'Moved away',
    });
    await refundBillPayment(context(staff({ role: 'super_admin' })), refund);
    expect(db.refundPayment).toHaveBeenCalledTimes(2);
  });

  it('refuses the desk, the Centre Manager, a physio and support', async () => {
    for (const role of ['front_desk', 'centre_manager', 'physiotherapist'] as const) {
      await expect(
        refundBillPayment(context(staff({ role, centreIds: [hsr] })), refund),
      ).rejects.toThrow(NotAllowedError);
    }
    await expect(refundBillPayment(context(staff({ support: true })), refund)).rejects.toThrow(
      ReadOnlyError,
    );
    await expect(refundsView(staff({ role: 'front_desk', centreIds: [hsr] }))).rejects.toThrow(
      NotAllowedError,
    );
    expect(db.refundPayment).not.toHaveBeenCalled();
  });

  it('says why the database refused', async () => {
    const cases: [string, string][] = [
      [
        'A refund is never more than was paid',
        'That is more than is left to refund on this payment.',
      ],
      [
        'An undone payment is not refunded',
        'This payment was undone, so there is nothing to refund.',
      ],
    ];
    for (const [cause, message] of cases) {
      db.refundPayment.mockRejectedValueOnce(refused(cause));
      await expect(refundBillPayment(context(), refund)).rejects.toThrow(new RefundError(message));
    }
    db.billCentre.mockResolvedValue(undefined);
    await expect(refundBillPayment(context(), refund)).rejects.toThrow(
      'That payment was not found.',
    );
  });

  it('looks up a payment by its printed number, and says when it is not one', async () => {
    expect((await refundsView(staff())).found).toEqual({ status: 'none' });
    expect((await refundsView(staff(), 'Test Patient')).found.status).toBe('invalid');
    db.refundablePayment.mockResolvedValue(undefined);
    expect((await refundsView(staff(), 'hsr-b-00042')).found).toEqual({
      status: 'missing',
      number: 'HSR-B-00042',
    });
    db.refundablePayment.mockResolvedValue({ paymentId, paidPaise: 90000, refundedPaise: 20000 });
    expect((await refundsView(staff(), 'HSR-INV-00007')).found).toMatchObject({
      status: 'found',
      leftPaise: 70000,
    });
    expect(db.refundablePayment).toHaveBeenLastCalledWith(fakeTx, 'HSR-INV-00007');
  });
});
