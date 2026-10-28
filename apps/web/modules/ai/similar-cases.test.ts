import type { SimilarPoolRow } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findSimilarCases } from './similar-cases';

const db = vi.hoisted(() => ({ similarCasePool: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);
const settings: Record<string, unknown> = {
  'ai.similar_cases_min': 3,
  'ai.similar_cases_max': 5,
  'assessment.acute_weeks_below': 3,
  'assessment.chronic_weeks_above': 12,
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));

const patientId = '00000000-0000-4000-8000-000000000d01';
const current = {
  episodeId: '00000000-0000-4000-8000-000000000e01',
  patientId,
  case: {
    region: 'knee' as const,
    age: 34,
    sex: 'female' as const,
    onset: 'gradual' as const,
    durationWeeks: 6,
    activities: ['running'],
    painZones: [],
  },
};
let count = 0;
const row = (extra: Partial<SimilarPoolRow> = {}): SimilarPoolRow => {
  count += 1;
  return {
    episodeId: `00000000-0000-4000-8000-${String(count).padStart(12, '0')}`,
    patientId: `10000000-0000-4000-8000-${String(count).padStart(12, '0')}`,
    answers: { region: 'knee', onset: 'gradual', activities: ['running'] },
    dateOfBirth: '1990-06-15',
    sex: 'female',
    bodyRegion: 'knee',
    submittedAt: new Date('2026-06-01T05:00:00Z'),
    conditionId: 'KNE-004',
    conditionName: 'Fake Tendinopathy',
    confirmedAt: new Date('2026-09-01T05:00:00Z'),
    ...extra,
  };
};

// AI-05: the sheet's similar confirmed cases, from the pool the system reads, each case read from
// its own form at its own date, and none that the identifier guard would refuse.
describe('finding similar confirmed cases', () => {
  beforeEach(() => {
    db.similarCasePool.mockReset();
  });

  it('reads each past case at its own form’s date, and never the patient’s own', async () => {
    db.similarCasePool.mockResolvedValue([row(), row(), row()]);
    const found = await findSimilarCases({} as never, current, [{ conditionId: 'KNE-004' }], []);
    expect(db.similarCasePool).toHaveBeenCalledWith({}, patientId);
    expect(found).toHaveLength(3);
    // Born June 1990, the form submitted 1 June 2026: 35 then, whatever today is.
    expect(found[0]).toMatchObject({ age: 35, confirmed: 'Fake Tendinopathy', n: 1 });
  });

  it('leaves out a case the guard would refuse, and is none when that leaves too few', async () => {
    db.similarCasePool.mockResolvedValue([
      row({ conditionName: 'Fake Tendinopathy' }),
      row({ conditionName: 'Fake Tendinopathy' }),
      row({ conditionName: 'Fake Sharma Syndrome' }),
      row({ conditionName: 'Fake Bursitis' }),
    ]);
    const found = await findSimilarCases({} as never, current, [], ['Asha Sharma']);
    expect(found.map((c) => c.confirmed)).not.toContain('Fake Sharma Syndrome');
    expect(found).toHaveLength(3);
    db.similarCasePool.mockResolvedValue([
      row(),
      row(),
      row({ conditionName: 'Fake Sharma Syndrome' }),
    ]);
    expect(await findSimilarCases({} as never, current, [], ['Asha Sharma'])).toEqual([]);
    // Refused cases at the top never empty a larger pool: the next ones come in.
    db.similarCasePool.mockResolvedValue([
      ...[1, 2, 3].map(() => row({ conditionName: 'Fake Sharma Syndrome' })),
      ...[1, 2, 3, 4, 5].map(() => row()),
    ]);
    expect(await findSimilarCases({} as never, current, [], ['Asha Sharma'])).toHaveLength(5);
  });
});
