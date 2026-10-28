import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCandidates } from './candidates';
import type { AiSheetPass } from './gate';

const db = vi.hoisted(() => ({ episodeCandidateInput: vi.fn(), knowledgeListings: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);
const settings: Record<string, unknown> = {
  'ai.candidates_min': 2,
  'ai.candidates_max': 3,
  'ai.must_rule_out_tiers': ['red_flag'],
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));

const episodeId = '00000000-0000-4000-8000-000000000e01';
const pass = { kbVersionId: '00000000-0000-4000-8000-000000000c01' } as AiSheetPass;
const listing = (n: number, extra: Record<string, unknown> = {}) => ({
  conditionId: `KNE-00${String(n)}`,
  region: 'knee',
  rowNumber: n,
  ageMin: null,
  ageMax: null,
  ageText: null,
  onsets: [],
  sex: null,
  redFlagTier: 'none',
  ...extra,
});

// AI-02: the shortlist reads the knowledge base version the AI gate was switched on for and the
// settings' bounds and tiers (the rules are unit tests in packages/schemas/src/candidates.test.ts).
describe('building the shortlist', () => {
  beforeEach(() => {
    db.episodeCandidateInput.mockReset();
    db.knowledgeListings.mockReset();
    db.episodeCandidateInput.mockResolvedValue({
      answers: { region: 'knee', onset: 'gradual' },
      dateOfBirth: '1996-01-15',
      sex: 'female',
      bodyRegion: 'knee',
    });
    db.knowledgeListings.mockResolvedValue([
      ...[1, 2, 3, 4, 5].map((n) => listing(n)),
      listing(9, { redFlagTier: 'red_flag' }),
    ]);
  });

  it('filters the pass’s version with the settings', async () => {
    const built = await buildCandidates(
      {} as Db,
      pass,
      episodeId,
      new Date('2026-10-28T06:00:00Z'),
    );
    expect(db.knowledgeListings).toHaveBeenCalledWith({}, pass.kbVersionId);
    expect(built?.kbVersionId).toBe(pass.kbVersionId);
    expect(built?.case).toMatchObject({ region: 'knee', age: 30, sex: 'female', onset: 'gradual' });
    expect(built?.shortlist.candidateCount).toBe(3);
    expect(built?.shortlist.items.filter((i) => i.mustRuleOut).map((i) => i.conditionId)).toEqual([
      'KNE-009',
    ]);
  });

  it('has nothing to build without a submitted form', async () => {
    db.episodeCandidateInput.mockResolvedValueOnce(undefined);
    expect(await buildCandidates({} as Db, pass, episodeId)).toBeNull();
    expect(db.knowledgeListings).not.toHaveBeenCalled();
  });
});
