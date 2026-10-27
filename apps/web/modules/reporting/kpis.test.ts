import type { Db, StaffMember } from '@clinic-mx/db';
import { addDays, type KpiDailyRow } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { figuresView } from './kpis';

const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  centreList: vi.fn(),
  kpiDaily: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
const targets = vi.hoisted((): Record<string, number> => ({
  'kpi.target_conversion_percent': 75,
  'kpi.target_notes_same_day_percent': 95,
}));
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(targets[key] ?? 50),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const kor = '00000000-0000-4000-8000-000000000102';
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
// 28 October 2026, 15:00 IST.
const now = new Date('2026-10-28T09:30:00Z');
const today = '2026-10-28';

const rows: KpiDailyRow[] = [
  { centreId: hsr, day: today, metric: 'consultation_conversion', numerator: 4, denominator: 5 },
  { centreId: kor, day: today, metric: 'consultation_conversion', numerator: 2, denominator: 5 },
  {
    centreId: hsr,
    day: addDays(today, -10),
    metric: 'consultation_conversion',
    numerator: 10,
    denominator: 10,
  },
  {
    centreId: hsr,
    day: addDays(today, -1),
    metric: 'revenue',
    numerator: 1_840_000,
    denominator: null,
  },
];

// DSH-01: the Super Admin's figures table.
describe('the figures', () => {
  beforeEach(() => {
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work({}),
    );
    db.kpiDaily.mockReset().mockResolvedValue(rows);
    db.centreList.mockReset().mockResolvedValue([
      { id: hsr, name: 'HSR Layout', active: true },
      { id: kor, name: 'Koramangala', active: true },
      { id: 'closed', name: 'Closed centre', active: false },
    ]);
  });

  it('counts each period overall and by centre against its target, for the last 30 days', async () => {
    const view = await figuresView(superAdmin, now);
    expect(db.kpiDaily).toHaveBeenCalledWith({}, addDays(today, -29), today);
    expect(view.countedAt).toContain('28 Oct 2026');
    const conversion = view.figures.find((figure) => figure.key === 'consultation_conversion');
    expect(conversion?.target).toBe('Over 75%');
    expect(conversion?.periods.today).toEqual({ text: '60%', status: 'off_target' });
    expect(conversion?.periods.week).toEqual({ text: '60%', status: 'off_target' });
    expect(conversion?.periods.month).toEqual({ text: '80%', status: 'on_target' });
    expect(conversion?.centres.map((entry) => [entry.name, entry.periods.today])).toEqual([
      ['HSR Layout', '80%'],
      ['Koramangala', '40%'],
    ]);
    const revenue = view.figures.find((figure) => figure.key === 'revenue');
    expect(revenue?.periods.today.text).toBe('₹0');
    expect(revenue?.periods.week.text).toBe('₹18,400');
    // Nothing to divide: no data, not 0%.
    const notes = view.figures.find((figure) => figure.key === 'notes_signed_same_day');
    expect(notes?.periods.month).toEqual({ text: 'No data yet', status: 'no_data' });
  });

  it('lists the figures not measured yet with what brings their data', async () => {
    const view = await figuresView(superAdmin, now);
    const nps = view.figures.find((figure) => figure.key === 'nps');
    expect(nps?.needs).toContain('PAT-07');
    expect(nps?.periods.month).toEqual({ text: 'Not measured yet', status: null });
    expect(nps?.centres).toEqual([]);
    expect(view.figures.find((figure) => figure.key === 'ai_top3')?.target).toBe(
      'Set after the first 3 months',
    );
  });

  it('is the Super Admin’s', async () => {
    for (const role of ['centre_manager', 'finance', 'front_desk', 'physiotherapist'] as const) {
      await expect(figuresView({ ...superAdmin, role }, now)).rejects.toThrow(NotAllowedError);
    }
    expect(db.kpiDaily).not.toHaveBeenCalled();
  });
});
