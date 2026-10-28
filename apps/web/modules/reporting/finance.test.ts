import type { Db, StaffMember } from '@clinic-mx/db';
import { addDays, centreColours } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { collectionsView, financeCsv, packagesView, revenueView, unpaidView } from './finance';

const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  centreList: vi.fn(),
  packageCounts: vi.fn(),
  paymentsDaily: vi.fn(),
  paymentsUndone: vi.fn(),
  refundsDaily: vi.fn(),
  revenueMonthly: vi.fn(),
  unpaidBills: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
vi.mock('../settings/settings', () => ({ getSetting: () => Promise.resolve(14) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const kor = '00000000-0000-4000-8000-000000000102';
const finance: StaffMember = {
  id: '00000000-0000-4000-8000-000000000202',
  email: 'finance@clinicmx.test',
  name: 'Test Finance',
  role: 'finance',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
};
// 28 October 2026, 15:00 IST.
const now = new Date('2026-10-28T09:30:00Z');
const today = '2026-10-28';

// DSH-04: Finance's screens and their CSV files.
describe('Finance’s dashboards', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work({}),
    );
    db.centreList.mockResolvedValue([
      { id: hsr, name: 'HSR Layout', active: true, colour: centreColours[0].value },
      { id: kor, name: 'Koramangala', active: true, colour: centreColours[1].value },
    ]);
    db.refundsDaily.mockResolvedValue([]);
  });

  it('collects today by method and centre, leaves undone payments out, and counts 30 days', async () => {
    db.paymentsDaily.mockResolvedValue([
      { centreId: hsr, day: today, method: 'upi', payments: 2, paise: 300_000 },
      { centreId: kor, day: today, method: 'cash', payments: 1, paise: 50_000 },
      { centreId: hsr, day: addDays(today, -3), method: 'card', payments: 1, paise: 120_000 },
    ]);
    db.paymentsUndone.mockResolvedValue([
      { centreId: hsr, day: today, payments: 1, paise: 90_000 },
    ]);
    // BIL-11: refunds are counted apart, today's and each day's.
    db.refundsDaily.mockResolvedValue([
      { centreId: hsr, day: today, refunds: 1, paise: 40_000 },
      { centreId: kor, day: addDays(today, -1), refunds: 1, paise: 10_000 },
    ]);
    const view = await collectionsView(finance, now);
    expect(view.today.total).toBe('₹3,500');
    expect(view.today.refunded).toEqual({ refunds: 1, text: '₹400' });
    expect(view.refundsDaily.slice(-2)).toEqual([10_000, 40_000]);
    expect(view.today.byMethod.map((row) => row.value)).toEqual([300_000, 0, 50_000]);
    expect(view.today.byCentre).toEqual([
      { name: 'HSR Layout', text: '₹3,000', payments: 2 },
      { name: 'Koramangala', text: '₹500', payments: 1 },
    ]);
    expect(view.today.undone).toEqual({ payments: 1, text: '₹900' });
    expect(view.daily.values).toHaveLength(30);
    expect(view.daily.values.at(-1)).toBe(350_000);
    expect(view.daily.values.at(-4)).toBe(120_000);
  });

  it('shows an inactive centre’s money by name, so the centres add up to the total', async () => {
    const wfd = '00000000-0000-4000-8000-000000000103';
    db.centreList.mockResolvedValue([
      { id: hsr, name: 'HSR Layout', active: true, colour: centreColours[0].value },
      { id: kor, name: 'Koramangala', active: true, colour: centreColours[1].value },
      { id: wfd, name: 'Whitefield', active: false, colour: centreColours[2].value },
    ]);
    db.paymentsDaily.mockResolvedValue([
      { centreId: hsr, day: today, method: 'upi', payments: 1, paise: 100_000 },
      { centreId: wfd, day: today, method: 'cash', payments: 1, paise: 40_000 },
    ]);
    db.paymentsUndone.mockResolvedValue([]);
    const view = await collectionsView(finance, now);
    expect(view.today.total).toBe('₹1,400');
    expect(view.today.byCentre.map((row) => row.name)).toEqual([
      'HSR Layout',
      'Koramangala',
      'Whitefield (inactive)',
    ]);
    const csv = await financeCsv(finance, 'collections', now);
    expect(csv.body).toContain('Whitefield (inactive),Cash,1,400.00');
    expect(csv.body).not.toContain(wfd);
  });

  it('lists unpaid bills with their age, and says what YTP balances wait for', async () => {
    db.unpaidBills.mockResolvedValue([
      {
        id: 'b1',
        number: 'HSR-B-00042',
        centreName: 'HSR Layout',
        kind: 'package',
        totalPaise: 2_400_000,
        createdAt: new Date('2026-10-25T06:00:00Z'),
        opNumber: 'HSR-00007',
        episodeId: 'e1',
      },
    ]);
    const view = await unpaidView(finance, now);
    expect(view).toMatchObject({ count: 1, total: '₹24,000' });
    expect(view.rows[0]).toEqual({
      number: 'HSR-B-00042',
      centre: 'HSR Layout',
      kind: 'Package',
      amount: '₹24,000',
      days: 3,
      opNumber: 'HSR-00007',
      // BIL-07: Finance opens the bill's plan and payment sheet to apply a discount.
      href: '/app/plans/e1',
    });
    expect(view.coming).toContain('BIL-10');
  });

  it('counts packages per centre, a centre with none at zero', async () => {
    db.packageCounts.mockResolvedValue([
      {
        centreId: hsr,
        active: 5,
        expiring: 2,
        expired: 1,
        sessionsLeftActive: 30,
        sessionsLeftExpired: 4,
      },
    ]);
    const view = await packagesView(finance, now);
    expect(view.expiringDays).toBe(14);
    expect(view.centres).toEqual([
      {
        name: 'HSR Layout',
        active: 5,
        expiring: 2,
        expired: 1,
        sessionsLeftActive: 30,
        sessionsLeftExpired: 4,
      },
      {
        name: 'Koramangala',
        active: 0,
        expiring: 0,
        expired: 0,
        sessionsLeftActive: 0,
        sessionsLeftExpired: 0,
      },
    ]);
  });

  it('sets each month against the same month a year before, asking a year at a time', async () => {
    db.revenueMonthly.mockImplementation((_tx: unknown, from: string) =>
      Promise.resolve(
        from.startsWith('2024')
          ? [{ centreId: hsr, month: '2025-10', kind: 'consultation', paise: 100_000 }]
          : [
              { centreId: hsr, month: '2026-10', kind: 'package', paise: 500_000 },
              { centreId: kor, month: '2026-10', kind: 'consultation', paise: 50_000 },
              { centreId: hsr, month: '2026-01', kind: 'consultation', paise: 20_000 },
            ],
      ),
    );
    const view = await revenueView(finance, now);
    expect(view.months).toHaveLength(12);
    expect(view.months.at(-1)).toBe('2026-10');
    expect(view.thisYear.at(-1)).toBe(550_000);
    expect(view.lastYear.at(-1)).toBe(100_000);
    expect(view.byCentre.map((entry) => entry.value)).toEqual([500_000, 50_000]);
    expect(view.byService).toEqual([
      { label: 'Consultation fee', value: 70_000, text: '₹700' },
      { label: 'Package', value: 500_000, text: '₹5,000' },
    ]);
    const calls = db.revenueMonthly.mock.calls as [unknown, string, string][];
    expect(calls.map(([, from, to]) => [from, to])).toEqual([
      ['2025-11-01', today],
      ['2024-11-01', '2025-10-31'],
    ]);
    expect(view.coming).toContain('BIL-11');
  });

  it('writes the tables as CSV with no patient names', async () => {
    db.unpaidBills.mockResolvedValue([
      {
        id: 'b1',
        number: '=HSR-B-1',
        centreName: 'HSR Layout',
        kind: 'consultation',
        totalPaise: 150_000,
        createdAt: new Date('2026-10-28T04:00:00Z'),
        opNumber: 'HSR-00007',
      },
    ]);
    const unpaid = await financeCsv(finance, 'unpaid', now);
    expect(unpaid.filename).toBe('clinic-mx-unpaid-2026-10-28.csv');
    expect(unpaid.body).toBe(
      "Bill,Centre,Kind,Rupees,Raised (IST),OP number\r\n'=HSR-B-1,HSR Layout,Consultation fee,1500.00,2026-10-28,HSR-00007\r\n",
    );
    db.paymentsDaily.mockResolvedValue([
      { centreId: hsr, day: today, method: 'upi', payments: 2, paise: 300_000 },
    ]);
    const collections = await financeCsv(finance, 'collections', now);
    expect(collections.body).toContain('2026-10-28,HSR Layout,UPI QR,2,3000.00');
  });

  it('is for the Super Admin and Finance only', async () => {
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist'] as const) {
      const someone = { ...finance, role };
      await expect(collectionsView(someone, now)).rejects.toThrow(NotAllowedError);
      await expect(unpaidView(someone, now)).rejects.toThrow(NotAllowedError);
      await expect(packagesView(someone, now)).rejects.toThrow(NotAllowedError);
      await expect(revenueView(someone, now)).rejects.toThrow(NotAllowedError);
      await expect(financeCsv(someone, 'unpaid', now)).rejects.toThrow(NotAllowedError);
    }
    expect(db.unpaidBills).not.toHaveBeenCalled();
  });
});
