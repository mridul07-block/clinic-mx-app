import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { overviewView } from './overview';

const views = vi.hoisted(() => ({
  centresDashboard: vi.fn(),
  outcomesDashboard: vi.fn(),
  collectionsView: vi.fn(),
  revenueView: vi.fn(),
}));
vi.mock('./manager', () => ({
  centresDashboard: views.centresDashboard,
  outcomesDashboard: views.outcomesDashboard,
}));
vi.mock('./finance', () => ({
  collectionsView: views.collectionsView,
  revenueView: views.revenueView,
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

// DSH-05: the Super Admin's overview, built from the Centre Manager's and Finance's views.
describe('the Super Admin’s overview', () => {
  beforeEach(() => {
    views.centresDashboard.mockResolvedValue({
      countedAt: '28 Oct 2026, 15:00 IST',
      centres: [today('HSR Layout'), today('Whitefield')],
      cells: [
        { key: 'consultations', label: 'Consultations', value: '12', change: '+2', status: null },
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
    });
    views.outcomesDashboard.mockResolvedValue({ bullets: [{ key: 'treatment_completion' }] });
    views.revenueView.mockResolvedValue({ months: ['2026-10'], thisYear: [5], lastYear: [3] });
  });

  it('shows every centre with its money today, the week with revenue, and the AI top 3 to come', async () => {
    const view = await overviewView(superAdmin, now);
    expect(view.centres.map((entry) => [entry.name, entry.collected])).toEqual([
      ['HSR Layout', '₹3,000'],
      ['Whitefield', '₹0'],
    ]);
    expect(view.cells.map((cell) => cell.key)).toEqual(['consultations', 'revenue']);
    expect(view.cells[1]).toMatchObject({
      value: '₹14,000',
      change: '+₹7,000 on the 7 days before',
    });
    expect(view.bullets).toHaveLength(1);
    expect(view.aiTop3).toEqual({
      label: 'Right diagnosis in AI top 3',
      target: 'Set after the first 3 months',
      needs: 'AI-03 (AI suggestions kept or dismissed)',
    });
    expect(views.outcomesDashboard).toHaveBeenCalledWith(superAdmin, '90', now);
  });

  it('is the Super Admin’s alone', async () => {
    for (const role of ['centre_manager', 'finance', 'front_desk', 'physiotherapist'] as const) {
      await expect(overviewView({ ...superAdmin, role }, now)).rejects.toThrow(NotAllowedError);
    }
  });
});
