import type { Db } from '@clinic-mx/db';
import type { Shortlist, ShortlistItem } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { runPreparationSheet } from './preparation-sheet';

const db = vi.hoisted(() => ({
  aiSheetGate: vi.fn(),
  claimSheet: vi.fn(),
  finishSheet: vi.fn(),
  episodeNameWords: vi.fn(),
  sheetStatus: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/service', () => ({
  systemService:
    (definition: { input: z.ZodType; run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run({ kind: 'transaction' }, definition.input.parse(input)),
}));
const settings: Record<string, unknown> = {
  'ai.sheet_top_count': 3,
  'ai.sheet_also_consider_count': 2,
  'ai.sheet_retry_after_seconds': 60,
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));
const candidates = vi.hoisted(() => ({ buildCandidates: vi.fn() }));
vi.mock('./candidates', () => candidates);
const gateway = vi.hoisted(() => ({ rankDiagnoses: vi.fn() }));
vi.mock('./gateway', () => gateway);
const similar = vi.hoisted(() => ({ findSimilarCases: vi.fn() }));
vi.mock('./similar-cases', () => similar);
const similarCase = {
  age: 31,
  sex: 'female',
  region: 'knee',
  symptoms: ['Front of knee'],
  durationWeeks: 8,
  sport: ['Running'],
  confirmed: 'Condition 2',
  n: 3,
};

const episodeId = '00000000-0000-4000-8000-000000000e01';
const kbVersionId = '00000000-0000-4000-8000-000000000c01';
const sheetId = '00000000-0000-4000-8000-000000000f01';
const runId = '00000000-0000-4000-8000-000000000a01';
const item = (n: number, extra: Partial<ShortlistItem> = {}): ShortlistItem => ({
  conditionId: `KNE-${String(n).padStart(3, '0')}`,
  region: 'knee',
  rowNumber: n,
  fit: { age: 'match', onset: 'unknown', sex: 'neutral' },
  filtered: true,
  mustRuleOut: false,
  ...extra,
});
const listing = (n: number) => ({
  conditionId: `KNE-${String(n).padStart(3, '0')}`,
  region: 'knee',
  rowNumber: n,
  name: `Condition ${String(n)}`,
  ageText: '15-40',
  onsetText: 'Slow',
  sexText: 'Equal',
  symptoms: 'Pain',
});
const shortlist = (count: number): Shortlist => ({
  status: 'ok',
  knowledgeRegion: 'knee',
  items: [
    item(40, { mustRuleOut: true, filtered: false }),
    ...Array.from({ length: count }, (_, i) => item(i + 1)),
  ],
  candidateCount: count,
  gaps: [],
});
const built = (count = 8) => ({
  kbVersionId,
  patientId: '00000000-0000-4000-8000-000000000d01',
  case: {
    region: 'knee',
    age: 34,
    sex: 'female',
    onset: 'gradual',
    durationWeeks: 6,
    activities: ['running'],
    painZones: [],
  },
  shortlist: shortlist(count),
  answers: { region: 'knee', complaint: 'Pain on stairs' },
  listings: [listing(40), ...Array.from({ length: count }, (_, i) => listing(i + 1))],
});
const run = () => runPreparationSheet({} as Db, episodeId);
const finished = (): { id: string; result: Record<string, unknown> }[] =>
  db.finishSheet.mock.calls.map((call: unknown[]) => ({
    id: (call[1] as { id: string }).id,
    result: call[2] as Record<string, unknown>,
  }));

// AI-03 done when: unknown IDs dropped; knowledge base text shown word for word; Keep and Dismiss
// stored; ready within 15 s. Here: the job, with the gateway's answer mocked (AI-01 tests it).
describe('the AI preparation sheet job', () => {
  beforeEach(() => {
    for (const fn of [
      ...Object.values(db),
      candidates.buildCandidates,
      gateway.rankDiagnoses,
      similar.findSimilarCases,
    ]) {
      fn.mockReset();
    }
    similar.findSimilarCases.mockResolvedValue([similarCase, similarCase, similarCase]);
    db.aiSheetGate.mockResolvedValue({ state: { on: true, kbVersionId, kbVersionNumber: 3 } });
    db.claimSheet.mockResolvedValue({ id: sheetId, claimedAt: new Date() });
    db.finishSheet.mockResolvedValue(true);
    db.episodeNameWords.mockResolvedValue(['Test Patient']);
    candidates.buildCandidates.mockResolvedValue(built());
  });

  it('does nothing while the sheet is off, for any reason', async () => {
    for (const reason of ['off', 'knowledge_base_changed', 'no_knowledge_base', 'unreadable']) {
      db.aiSheetGate.mockResolvedValueOnce({ state: { on: false, reason } });
      expect(await run()).toBe('off');
    }
    expect(candidates.buildCandidates).not.toHaveBeenCalled();
    expect(db.claimSheet).not.toHaveBeenCalled();
  });

  it('ranks the shortlist and keeps the valid suggestions, ranked from 1', async () => {
    gateway.rankDiagnoses.mockResolvedValue({
      status: 'ok',
      runId,
      // 99 is not on the list, 3 is ranked twice, and there are more than five.
      output: [99, 3, 3, 1, 2, 4, 5, 6, 7].map((place) => ({
        n: place + 1,
        conditionId: `KNE-${String(place).padStart(3, '0')}`,
        reason: `Reason ${String(place)}`,
      })),
    });
    expect(await run()).toBe('ready');
    const [call] = gateway.rankDiagnoses.mock.calls;
    const sent = call?.[2] as {
      rows: { conditionId: string; mustRuleOut: boolean }[];
      forbidden: string[];
    };
    expect(sent.rows[0]).toMatchObject({ conditionId: 'KNE-040', mustRuleOut: true });
    expect(sent.forbidden).toEqual(['Test Patient']);
    // AI-05: the similar confirmed cases, chosen for this case and its numbered rows, are sent and
    // kept with the sheet exactly as sent.
    const [, current, numberedRows, forbidden] = similar.findSimilarCases.mock.calls[0] as [
      unknown,
      { episodeId: string; patientId: string },
      { conditionId: string }[],
      string[],
    ];
    expect(current).toMatchObject({ episodeId, patientId: built().patientId });
    expect(numberedRows).toEqual(sent.rows);
    expect(forbidden).toEqual(['Test Patient']);
    expect((call?.[2] as { similar: unknown[] }).similar).toHaveLength(3);
    expect(db.claimSheet.mock.calls[0]?.[1]).toMatchObject({
      episodeId,
      kbVersionId,
      similar: [similarCase, similarCase, similarCase],
      retryAfterSeconds: 60,
      case: expect.objectContaining({ region: 'knee', symptoms: ['Pain on stairs'] }) as object,
    });
    const result = finished()[0]?.result as {
      status: string;
      suggestions: { conditionId: string; rank: number; section: string }[];
    };
    expect(result.status).toBe('ready');
    expect(result.suggestions.map((s) => [s.conditionId, s.rank, s.section])).toEqual([
      ['KNE-003', 1, 'top'],
      ['KNE-001', 2, 'top'],
      ['KNE-002', 3, 'top'],
      ['KNE-004', 4, 'also_consider'],
      ['KNE-005', 5, 'also_consider'],
    ]);
  });

  it('is unavailable with the gateway’s reason, keeping its must rule out', async () => {
    gateway.rankDiagnoses.mockResolvedValue({
      status: 'unavailable',
      reason: 'not_configured',
      runId,
    });
    expect(await run()).toBe('unavailable');
    expect(finished()).toEqual([
      { id: sheetId, result: { status: 'unavailable', reason: 'not_configured', aiRunId: runId } },
    ]);
    expect(db.claimSheet.mock.calls[0]?.[1]).toMatchObject({
      shortlist: expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ mustRuleOut: true }),
        ]) as unknown[],
      }) as object,
    });
  });

  it('is unavailable when no suggestion is on the list', async () => {
    gateway.rankDiagnoses.mockResolvedValue({
      status: 'ok',
      runId,
      output: [{ n: 99, conditionId: 'KNE-099', reason: 'Not on the list' }],
    });
    expect(await run()).toBe('unavailable');
    expect(finished()[0]?.result).toMatchObject({ reason: 'no_valid_suggestions', aiRunId: runId });
  });

  it('calls no model without a region or a form', async () => {
    candidates.buildCandidates.mockResolvedValueOnce({
      ...built(),
      case: { ...built().case, region: null },
      shortlist: { ...shortlist(0), status: 'no_region', knowledgeRegion: null, items: [] },
    });
    expect(await run()).toBe('unavailable');
    candidates.buildCandidates.mockResolvedValueOnce(null);
    expect(await run()).toBe('unavailable');
    expect(gateway.rankDiagnoses).not.toHaveBeenCalled();
    expect(finished().map((f) => f.result.reason)).toEqual(['no_region', 'no_form']);
  });

  it('pays for no second model call while the sheet is made or being made', async () => {
    db.claimSheet.mockResolvedValue(null);
    db.sheetStatus.mockResolvedValueOnce('ready');
    expect(await run()).toBe('already');
    // Another run holds it: the job tries again once that run's claim has lapsed.
    db.sheetStatus.mockResolvedValueOnce('pending');
    expect(await run()).toBe('busy');
    expect(gateway.rankDiagnoses).not.toHaveBeenCalled();
    expect(db.finishSheet).not.toHaveBeenCalled();
  });

  it('writes nothing once another run has taken the sheet over', async () => {
    gateway.rankDiagnoses.mockResolvedValue({ status: 'unavailable', reason: 'failed', runId });
    db.finishSheet.mockResolvedValue(false);
    expect(await run()).toBe('superseded');
  });
});
