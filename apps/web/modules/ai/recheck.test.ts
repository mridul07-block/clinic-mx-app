import type { Db, StaffMember } from '@clinic-mx/db';
import type { ShortlistItem } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { loadRecheck, recheckConsultation } from './recheck';
import { AiSheetError } from './sheet';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  consultationRecord: vi.fn(),
  sheetForEpisode: vi.fn(),
  canDisposeSheet: vi.fn(),
  knowledgeObjective: vi.fn(),
  knowledgeListings: vi.fn(),
  claimRecheck: vi.fn(),
  finishRecheck: vi.fn(),
  episodeNameWords: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ settingsDb: () => ({}), appDb: () => ({}) }));
vi.mock('../access/service', async () => {
  const actual: Record<string, unknown> = await vi.importActual('../access/service');
  return {
    ...actual,
    systemService:
      (definition: { input: z.ZodType; run: (tx: unknown, input: unknown) => unknown }) =>
      (_db: unknown, input: unknown) =>
        definition.run(fakeTx, definition.input.parse(input)),
  };
});
const settings: Record<string, unknown> = {
  'ai.sheet_retry_after_seconds': 60,
  'ai.sheet_top_count': 3,
  'ai.sheet_also_consider_count': 2,
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));
const gate = vi.hoisted(() => ({ aiSheetPass: vi.fn() }));
vi.mock('./gate', () => gate);
const gateway = vi.hoisted(() => ({ recheckWithFindings: vi.fn() }));
vi.mock('./gateway', () => gateway);

const kbVersionId = '00000000-0000-4000-8000-000000000c01';
const consultationId = '00000000-0000-4000-8000-000000000d01';
const episodeId = '00000000-0000-4000-8000-000000000e01';
const consultant: StaffMember = {
  id: '00000000-0000-4000-8000-000000000204',
  email: 'consultant@clinicmx.test',
  name: 'Test Consultant',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: true,
  centreIds: ['00000000-0000-4000-8000-000000000101'],
  support: false,
};
const context = (actor = consultant) => ({ db: {} as Db, actor });
const item = (n: number): ShortlistItem => ({
  conditionId: `KNE-00${String(n)}`,
  region: 'knee',
  rowNumber: n,
  fit: { age: 'match', onset: 'unknown', sex: 'neutral' },
  filtered: true,
  mustRuleOut: false,
});
const record = (extra: Record<string, unknown> = {}) => ({
  id: consultationId,
  episodeId,
  physioId: consultant.id,
  kbVersionId,
  status: 'draft',
  version: 4,
  centreId: consultant.centreIds[0],
  sections: {
    objective: {
      notes: 'Seen with Fake Name',
      region: 'knee',
      side: 'left',
      measures: {},
      tests: [{ key: 'knee.lachman', result: 'positive', interpretation: 'Fake Name' }],
    },
  },
  ...extra,
});
const sheet = (extra: Record<string, unknown> = {}) => ({
  id: 'sheet-1',
  kbVersionId,
  case: {
    age: 30,
    sex: 'female',
    region: 'knee',
    symptoms: [],
    durationWeeks: 4,
    sport: [],
    goal: null,
  },
  shortlist: {
    status: 'ok',
    knowledgeRegion: 'knee',
    items: [1, 2, 3].map(item),
    candidateCount: 3,
    gaps: [],
  },
  recheck: null,
  similar: [
    {
      age: 31,
      sex: 'female',
      region: 'knee',
      symptoms: [],
      durationWeeks: 8,
      sport: [],
      confirmed: 'Fake condition 3',
      n: 3,
    },
  ],
  ...extra,
});
const listing = (n: number) => ({
  conditionId: `KNE-00${String(n)}`,
  region: 'knee',
  rowNumber: n,
  name: `Fake condition ${String(n)}`,
  ageText: null,
  onsetText: null,
  sexText: null,
  symptoms: null,
});
const tap = (version = 4) =>
  recheckConsultation(context(), { consultationId, baseVersion: version });

// AI-04 done when: reranks with examination results only when tapped. The gateway's answer is
// mocked (AI-01 tests the call itself).
describe('recheck with findings', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), gate.aiSheetPass, gateway.recheckWithFindings]) {
      fn.mockReset();
    }
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    gate.aiSheetPass.mockResolvedValue({ kbVersionId });
    db.consultationRecord.mockResolvedValue(record());
    db.sheetForEpisode.mockResolvedValue(sheet());
    db.canDisposeSheet.mockResolvedValue(true);
    db.knowledgeObjective.mockResolvedValue({
      measures: [],
      specialTests: [{ key: 'knee.lachman', test: 'Lachman test' }],
    });
    db.knowledgeListings.mockResolvedValue([1, 2, 3].map(listing));
    db.claimRecheck.mockResolvedValue({ claimedAt: new Date() });
    db.finishRecheck.mockResolvedValue(true);
    db.episodeNameWords.mockResolvedValue(['Fake Name']);
    gateway.recheckWithFindings.mockResolvedValue({
      status: 'ok',
      runId: 'run-2',
      output: [
        { n: 3, conditionId: 'KNE-003', reason: 'Lachman positive' },
        { n: 9, conditionId: 'KNE-009', reason: 'Not on the list' },
        { n: 1, conditionId: 'KNE-001', reason: 'Still possible' },
      ],
    });
  });

  it('sends the findings in the knowledge base’s words and keeps the valid reranking', async () => {
    expect(await tap()).toBe('ready');
    const [, , call] = gateway.recheckWithFindings.mock.calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(call.findings).toEqual(['Lachman test: Positive']);
    // The name words go only to the guard, which refuses a request that carries them.
    const { forbidden, ...sent } = call;
    expect(JSON.stringify(sent)).not.toContain('Fake Name');
    expect(forbidden).toEqual(['Fake Name']);
    // AI-05: the sheet's own similar cases, as it sent them; none fetched again.
    expect(sent.similar).toEqual(sheet().similar);
    expect(db.claimRecheck.mock.calls[0]?.[1]).toMatchObject({
      sheetId: 'sheet-1',
      findings: ['Lachman test: Positive'],
      by: consultant.id,
    });
    const result = db.finishRecheck.mock.calls[0]?.[2] as {
      status: string;
      aiRunId: string;
      suggestions: { conditionId: string; rank: number }[];
    };
    expect(result.status).toBe('ready');
    expect(result.aiRunId).toBe('run-2');
    expect(result.suggestions.map((s) => [s.conditionId, s.rank])).toEqual([
      ['KNE-003', 1],
      ['KNE-001', 2],
    ]);
  });

  it('is unavailable when the model is not there, and never blocks', async () => {
    gateway.recheckWithFindings.mockResolvedValue({
      status: 'unavailable',
      reason: 'not_configured',
      runId: 'run-2',
    });
    expect(await tap()).toBe('unavailable');
    expect(db.finishRecheck.mock.calls[0]?.[2]).toEqual({
      status: 'unavailable',
      reason: 'not_configured',
      aiRunId: 'run-2',
    });
  });

  it('pays for no second call while one runs, or for the same findings again', async () => {
    db.claimRecheck.mockResolvedValue(null);
    db.sheetForEpisode.mockResolvedValue(sheet({ recheck: { status: 'pending' } }));
    expect(await tap()).toBe('busy');
    db.sheetForEpisode.mockResolvedValue(sheet({ recheck: { status: 'ready' } }));
    expect(await tap()).toBe('already');
    expect(gateway.recheckWithFindings).not.toHaveBeenCalled();
  });

  it('never leaves the recheck taken when something fails after the claim', async () => {
    gateway.recheckWithFindings.mockRejectedValue(new Error('database gone'));
    await expect(tap()).rejects.toThrow('database gone');
    expect(db.finishRecheck.mock.calls[0]?.[2]).toEqual({
      status: 'unavailable',
      reason: 'failed',
      aiRunId: null,
    });
  });

  it('shows the panel to the consultation’s consultant only, and a stopped run as stopped', async () => {
    const pending = (minutesAgo: number) =>
      sheet({
        recheck: {
          status: 'pending',
          reason: null,
          findings: ['Lachman test: Positive'],
          claimedAt: new Date(Date.now() - minutesAgo * 60_000),
          readyAt: null,
          suggestions: [],
        },
      });
    db.sheetForEpisode.mockResolvedValue(pending(0));
    expect((await loadRecheck(consultant, consultationId))?.recheck).toMatchObject({
      status: 'pending',
      stopped: false,
    });
    db.sheetForEpisode.mockResolvedValue(pending(5));
    expect((await loadRecheck(consultant, consultationId))?.recheck?.stopped).toBe(true);
    // Another consultant's consultation, and a sheet from an earlier knowledge base: no panel.
    db.consultationRecord.mockResolvedValue(record({ physioId: 'someone-else' }));
    expect(await loadRecheck(consultant, consultationId)).toBeNull();
    db.consultationRecord.mockResolvedValue(record());
    db.sheetForEpisode.mockResolvedValue(sheet({ kbVersionId: 'other' }));
    expect(await loadRecheck(consultant, consultationId)).toBeNull();
  });

  it('is the visit’s consultant’s, on an unsigned, saved consultation with findings', async () => {
    const refusals: [() => void, string][] = [
      [() => gate.aiSheetPass.mockResolvedValue(null), 'switched off'],
      [() => db.consultationRecord.mockResolvedValue(record({ status: 'signed' })), 'unsigned'],
      [
        () => db.consultationRecord.mockResolvedValue(record({ physioId: 'someone-else' })),
        'unsigned',
      ],
      [() => db.consultationRecord.mockResolvedValue(record({ version: 5 })), 'still saving'],
      [() => db.canDisposeSheet.mockResolvedValue(false), 'consultant of the visit'],
      [
        () => db.sheetForEpisode.mockResolvedValue(sheet({ kbVersionId: 'other' })),
        'knowledge base changed',
      ],
      [
        () =>
          db.consultationRecord.mockResolvedValue(
            record({ sections: { objective: { tests: [], measures: {} } } }),
          ),
        'Record a special test',
      ],
      [() => db.sheetForEpisode.mockResolvedValue(undefined), 'no preparation sheet'],
    ];
    for (const [arrange, message] of refusals) {
      arrange();
      await expect(tap()).rejects.toThrow(AiSheetError);
      await expect(tap()).rejects.toThrow(message);
      gate.aiSheetPass.mockResolvedValue({ kbVersionId });
      db.consultationRecord.mockResolvedValue(record());
      db.canDisposeSheet.mockResolvedValue(true);
      db.sheetForEpisode.mockResolvedValue(sheet());
    }
    expect(db.claimRecheck).not.toHaveBeenCalled();
    expect(gateway.recheckWithFindings).not.toHaveBeenCalled();
  });
});
