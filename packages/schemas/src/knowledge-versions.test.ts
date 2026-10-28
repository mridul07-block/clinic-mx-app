import { describe, expect, it } from 'vitest';
import {
  approveKnowledgeVersionSchema,
  importReportSummarySchema,
  knowledgeVersionApprovable,
  knowledgeVersionStandingsOf,
} from './knowledge-versions';

// SET-06: where each version stands, which may be approved, the approval's input, and the import
// report as the viewer reads it.
describe('Knowledge base versions', () => {
  it('makes the newest import live before any approval, then the newest approved', () => {
    const drafts = [
      { number: 1, status: 'draft' as const },
      { number: 2, status: 'draft' as const },
    ];
    expect([...knowledgeVersionStandingsOf(drafts)]).toEqual([
      [1, 'awaiting'],
      [2, 'live'],
    ]);
    const some = [
      { number: 1, status: 'approved' as const },
      { number: 2, status: 'draft' as const },
      { number: 3, status: 'approved' as const },
      { number: 4, status: 'draft' as const },
    ];
    expect([...knowledgeVersionStandingsOf(some)]).toEqual([
      [1, 'superseded'],
      [2, 'passed_over'],
      [3, 'live'],
      [4, 'awaiting'],
    ]);
    expect(knowledgeVersionApprovable({ number: 4, status: 'draft' }, some)).toBe(true);
    expect(knowledgeVersionApprovable({ number: 2, status: 'draft' }, some)).toBe(false);
    expect(knowledgeVersionApprovable({ number: 3, status: 'approved' }, some)).toBe(false);
    expect(knowledgeVersionApprovable({ number: 1, status: 'draft' }, drafts)).toBe(true);
  });

  it('needs the confirmation, and keeps a note short and trimmed', () => {
    const versionId = '00000000-0000-4000-8000-000000000001';
    expect(
      approveKnowledgeVersionSchema.parse({ versionId, confirmed: true, notes: ' Read ' }),
    ).toEqual({ versionId, confirmed: true, notes: 'Read' });
    expect(
      approveKnowledgeVersionSchema.parse({ versionId, confirmed: true, notes: '  ' }).notes,
    ).toBe(undefined);
    expect(approveKnowledgeVersionSchema.safeParse({ versionId }).success).toBe(false);
    expect(
      approveKnowledgeVersionSchema.safeParse({
        versionId,
        confirmed: true,
        notes: 'x'.repeat(1001),
      }).success,
    ).toBe(false);
  });

  it('reads an import report, and an older one with parts missing', () => {
    const report = importReportSummarySchema.parse({
      files: [{ region: 'knee', fileName: 'Knee.xlsx', sha256: 'abc', rows: 40, title: 'x' }],
      totals: { listings: 354, conditions: 340, merged: 14 },
      gaps: ['Thoracic workbook missing'],
      redFlagTiers: { red_flag: 12 },
    });
    expect(report.files[0]?.rows).toBe(40);
    expect(report.gaps).toEqual(['Thoracic workbook missing']);
    expect(importReportSummarySchema.parse({}).merged).toEqual([]);
  });
});
