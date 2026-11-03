import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { overviewView } from './overview';

const views = vi.hoisted(() => ({
  alertsDashboard: vi.fn(),
  centresDashboard: vi.fn(),
  collectionsView: vi.fn(),
}));
vi.mock('./manager', () => ({
  alertsDashboard: views.alertsDashboard,
  centresDashboard: views.centresDashboard,
}));
vi.mock('./finance', () => ({
  collectionsView: views.collectionsView,
}));

const superAdmin: StaffMember = {
  id: '00000000-0000-4000-8000-000000000201',
  email: 'super.admin@clinicmx.test',
  name: 'Test Super Admin',
  role: 'super_admin',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
};
const now = new Date('2026-10-28T09:30:00Z');
const today = (name: string) => ({
  id: name,
  name,
  utilisation: 60,
  booked: 144,
  rostered: 240,
  noShows: 1,
  waiting: { median: 4, longest: 9, now: 0, longestNow: null },
  paymentPending: { sinceToday: 0, earlier: 2 },
});

// DSH-05: the Super Admin's Home, built from the Centre Manager's and Finance's views.
describe('the Super Admin’s Home', () => {
  beforeEach(() => {
    views.centresDashboard.mockResolvedValue({
      countedAt: '28 Oct 2026, 15:00 IST',
      centres: [today('HSR Layout'), today('Whitefield')],
      cells: [
        { key: 'consultations', label: 'Consultations', value: '12', change: '+2', status: null },
        { key: 'no_shows', label: 'No shows', value: '1', change: '+1', status: null },
      ],
      runningLateMinutes: 15,
    });
    views.collectionsView.mockResolvedValue({
      today: { byCentre: [{ name: 'HSR Layout', text: '₹3,000', payments: 2 }] },
      // 30 days: 7 before worth 1,000 each, the last 7 worth 2,000 each (paise ×100).
      daily: {
        values: [
          ...Array.from({ length: 16 }, () => 0),
          ...Array.from({ length: 7 }, () => 100_000),
          ...Array.from({ length: 7 }, () => 200_000),
        ],
      },
      // BIL-11: a refund of 500 on the last day comes off the week's revenue.
      refundsDaily: [...Array.from({ length: 29 }, () => 0), 50_000],
    });
    views.alertsDashboard.mockResolvedValue({
      items: [
        { item: 'unsigned_notes', label: 'Notes', link: '/app/tasks', where: null, total: 2 },
        { item: 'reviews_open', label: 'Reviews', link: '/app/tasks', where: null, total: 0 },
        { item: 'red_flags', label: 'Red flags', link: '/app/alerts', where: null, total: 5 },
      ],
    });
  });

  it('shows what is waiting, largest first, every centre’s money today and the week', async () => {
    const view = await overviewView(superAdmin, now);
    expect(view.needs.map((item) => item.label)).toEqual(['Red flags', 'Notes']);
    expect(view.centres.map((entry) => [entry.name, entry.collected])).toEqual([
      ['HSR Layout', '₹3,000'],
      ['Whitefield', '₹0'],
    ]);
    // Today's no shows are on each centre's row, so the week leaves them out.
    expect(view.cells.map((cell) => cell.key)).toEqual(['consultations', 'revenue']);
    expect(view.cells[1]).toMatchObject({
      value: '₹13,500',
      change: '+₹6,500 on the 7 days before',
    });
  });

  it('is the Super Admin’s alone', async () => {
    for (const role of ['centre_manager', 'finance', 'front_desk', 'physiotherapist'] as const) {
      await expect(overviewView({ ...superAdmin, role }, now)).rejects.toThrow(NotAllowedError);
    }
  });
});
