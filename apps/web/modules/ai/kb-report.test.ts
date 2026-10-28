import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { KbReportBody } from '@clinic-mx/schemas';
import { loadKbReport, loadKbReports, runKbReport } from './kb-report';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  kbReportData: vi.fn(),
  kbReportOf: vi.fn(),
  kbReports: vi.fn(),
  latestKnowledgeVersion: vi.fn(),
  queueNextKbReport: vi.fn(),
  storeKbReport: vi.fn(),
  withStaffAccess: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({}) }));
vi.mock('../access/service', () => ({
  systemService:
    (definition: { input: z.ZodType; run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run(fakeTx, definition.input.parse(input)),
}));
const settings: Record<string, unknown> = {
  'ai.kb_report_dismissed_min_marked': 5,
  'ai.kb_report_dismissed_share_percent': 50,
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));

const data = {
  dispositions: [
    { kbVersionNumber: 1, conditionId: 'KNE-001', name: 'Fake one', kept: 1, dismissed: 5 },
    { kbVersionNumber: 1, conditionId: 'KNE-002', name: 'Fake two', kept: 4, dismissed: 1 },
  ],
  sheetsReady: 4,
  sheetsUnavailable: 1,
  unmarked: 2,
  labels: [],
  kbVersions: [{ id: '00000000-0000-4000-8000-000000000c01', number: 1 }],
};
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
const afterOctober = new Date('2026-10-31T19:30:00Z');

// AI-08 done when: often dismissed suggestions, missed diagnoses, changes at review; sent to the
// Super Admin. Here: the monthly job and who reads (the counts are the database tests').
describe('the monthly knowledge base report job', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.kbReportData.mockResolvedValue(data);
    db.latestKnowledgeVersion.mockResolvedValue({ id: data.kbVersions[0]?.id });
    db.storeKbReport.mockResolvedValue('report-1');
    db.queueNextKbReport.mockResolvedValue('2026-11');
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
  });

  it('queues next month first, then builds once the month has ended, once', async () => {
    expect(await runKbReport({} as Db, { month: '2026-10' }, afterOctober)).toBe('built');
    expect(db.queueNextKbReport).toHaveBeenCalledWith(fakeTx, '2026-10');
    const stored = db.storeKbReport.mock.calls[0]?.[1] as {
      month: string;
      body: KbReportBody;
    };
    expect(stored.month).toBe('2026-10');
    expect(stored.body.oftenDismissed.map((r) => r.conditionId)).toEqual(['KNE-001']);
    expect(stored.body.totals).toMatchObject({ marked: 11, unmarked: 2, sheetsReady: 4 });
    // No sheet compared: no single top size to name.
    expect(stored.body.thresholds).toEqual({ minMarked: 5, sharePercent: 50, topCount: null });

    db.storeKbReport.mockResolvedValue(null);
    expect(await runKbReport({} as Db, { month: '2026-10' }, afterOctober)).toBe('already');
  });

  it('builds nothing before the month ends, and keeps the chain when a build fails', async () => {
    expect(
      await runKbReport({} as Db, { month: '2026-10' }, new Date('2026-10-31T18:29:00Z')),
    ).toBe('early');
    expect(db.storeKbReport).not.toHaveBeenCalled();
    db.kbReportData.mockRejectedValue(new Error('database gone'));
    await expect(runKbReport({} as Db, { month: '2026-10' }, afterOctober)).rejects.toThrow(
      'database gone',
    );
    expect(db.queueNextKbReport).toHaveBeenCalledTimes(2);
    await expect(runKbReport({} as Db, { month: '2026-13' }, afterOctober)).rejects.toThrow();
  });

  it('is read by the Super Admin only, never support', async () => {
    db.kbReports.mockResolvedValue([]);
    expect(await loadKbReports(superAdmin)).toEqual([]);
    for (const someone of [
      { ...superAdmin, support: true },
      { ...superAdmin, role: 'centre_manager' as const },
      { ...superAdmin, role: 'physiotherapist' as const, treatsPatients: true, consultant: true },
    ]) {
      expect(await loadKbReports(someone)).toBeNull();
      expect(await loadKbReport(someone, '2026-10')).toBeUndefined();
    }
    expect(await loadKbReport(superAdmin, 'not-a-month')).toBeUndefined();
    expect(db.kbReports).toHaveBeenCalledTimes(1);
  });
});
