import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { PaymentError, recordBillPayment, undoBillPayment } from './payments';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  billCentre: vi.fn(),
  recordPayment: vi.fn(),
  undoPayment: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const billId = '00000000-0000-4000-8000-000000000b01';
const paymentId = '00000000-0000-4000-8000-000000000c01';
const desk = (extra: Partial<StaffMember> = {}): StaffMember => ({
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
const context = (actor = desk()) => ({ db: {} as Db, actor });
/** A refusal as drizzle passes on Postgres's. */
const refused = (message: string) =>
  Object.assign(new Error('Failed query'), { cause: { message } });

// BIL-06: the desk at the bill's centre marks it paid for its whole total, or undoes a mistake on
// its day; the database's refusals reach the desk in plain words.
describe('counter payments', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.billCentre.mockResolvedValue(hsr);
    db.recordPayment.mockResolvedValue(paymentId);
  });

  it('records the method and the trimmed reference, never an amount', async () => {
    await recordBillPayment(context(), { billId, method: 'upi', reference: '  UPI-1  ' });
    expect(db.recordPayment).toHaveBeenCalledWith(fakeTx, {
      billId,
      method: 'upi',
      reference: 'UPI-1',
    });
    await recordBillPayment(context(), { billId, method: 'cash', reference: '' });
    expect(db.recordPayment).toHaveBeenLastCalledWith(fakeTx, {
      billId,
      method: 'cash',
      reference: undefined,
    });
  });

  it('says a bill is already paid, and that yesterday’s payment is a refund for Finance', async () => {
    db.recordPayment.mockRejectedValue(refused('Only an unpaid bill is paid'));
    await expect(recordBillPayment(context(), { billId, method: 'card' })).rejects.toThrow(
      new PaymentError('This bill is already paid.'),
    );
    db.undoPayment.mockRejectedValue(
      refused('A payment is undone only on the day it was recorded'),
    );
    await expect(
      undoBillPayment(context(), { paymentId, reason: 'Wrong patient' }),
    ).rejects.toThrow(
      'A payment is undone on the day it was recorded; after that Finance makes a refund.',
    );
    // BIL-08: a package with a session used is Finance's refund.
    db.undoPayment.mockRejectedValue(
      refused('Sessions from this package have been used; Finance refunds it'),
    );
    await expect(
      undoBillPayment(context(), { paymentId, reason: 'Wrong package' }),
    ).rejects.toThrow(
      'A session from this package has been used, so the payment cannot be undone; Finance makes a refund.',
    );
  });

  it('refuses no method, the desk at another centre and a physio', async () => {
    await expect(recordBillPayment(context(), { billId, method: '' })).rejects.toThrow(
      'Choose how the patient paid.',
    );
    await expect(
      recordBillPayment(context(desk({ centreIds: [koramangala] })), { billId, method: 'cash' }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      recordBillPayment(context(desk({ role: 'physiotherapist', treatsPatients: true })), {
        billId,
        method: 'cash',
      }),
    ).rejects.toThrow(NotAllowedError);
    expect(db.recordPayment).not.toHaveBeenCalled();
  });
});
