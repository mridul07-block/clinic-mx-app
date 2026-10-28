import {
  shortlistCandidates,
  screeningRegions,
  knowledgeRegionOfScreening,
  type CandidateCase,
  type CandidateSettings,
  type PatientSex,
} from '@clinic-mx/schemas';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildKnowledge, type Listing } from './build';
import { readConditionIds, WORKBOOK_FOLDER_PATH } from './paths';
import { readWorkbooks } from './workbook';

// AI-02 done when: 15 to 25 rows by region, age, sex, onset, duration; matching high risk rows
// always added. Here over the real workbooks, for every region and a grid of ages, sexes and
// onsets (packages/schemas/src/candidates.test.ts holds the rules case by case).
let listings: Listing[];

beforeAll(async () => {
  const workbooks = await readWorkbooks(WORKBOOK_FOLDER_PATH);
  listings = buildKnowledge(workbooks, await readConditionIds()).listings;
}, 60_000);

const settings: CandidateSettings = { min: 15, max: 25, mustRuleOutTiers: ['red_flag'] };
const ages = [null, 8, 16, 30, 45, 70];
const sexes: (PatientSex | null)[] = ['female', 'male', 'other', null];
const onsets = ['gradual', 'sudden', null] as const;

const patient = (c: Partial<CandidateCase>): CandidateCase => ({
  region: 'knee',
  age: null,
  sex: null,
  onset: null,
  durationWeeks: null,
  activities: [],
  painZones: [],
  ...c,
});

describe('the candidate filter over the real workbooks', () => {
  it('keeps 15 to 25 rows of the region, with every high risk row for the age', () => {
    for (const region of screeningRegions) {
      const regionRows = listings.filter((l) => l.region === knowledgeRegionOfScreening[region]);
      for (const age of ages) {
        for (const sex of sexes) {
          for (const onset of onsets) {
            const c = patient({ region, age, sex, onset });
            const result = shortlistCandidates(listings, c, settings);
            const label = `${region} ${String(age)} ${String(sex)} ${String(onset)}`;
            expect(result.candidateCount, label).toBeGreaterThanOrEqual(15);
            expect(result.candidateCount, label).toBeLessThanOrEqual(25);
            expect(
              result.items.every((i) => i.region === knowledgeRegionOfScreening[region]),
              label,
            ).toBe(true);
            expect(
              result.items.some((i) => i.conditionId.startsWith('BSC-')),
              label,
            ).toBe(false);
            const highRisk = regionRows
              .filter(
                (l) =>
                  l.redFlagTier === 'red_flag' &&
                  // An age stated at onset says nothing without a duration (none here).
                  (age === null ||
                    (l.ageText?.toLowerCase().includes('onset') ?? false) ||
                    ((l.ageMin === null || age >= l.ageMin) &&
                      (l.ageMax === null || age <= l.ageMax))),
              )
              .map((l) => l.conditionId)
              .sort();
            expect(
              result.items
                .filter((i) => i.mustRuleOut)
                .map((i) => i.conditionId)
                .sort(),
              label,
            ).toEqual(highRisk);
            expect(shortlistCandidates(listings.toReversed(), c, settings), label).toEqual(result);
          }
        }
      }
    }
  });

  it('sends every red flag row of the region to must rule out when the age is unknown', () => {
    const counts = Object.fromEntries(
      screeningRegions.map((region) => [
        region,
        shortlistCandidates(listings, patient({ region }), settings).items.filter(
          (i) => i.mustRuleOut,
        ).length,
      ]),
    );
    const stated = Object.fromEntries(
      screeningRegions.map((region) => [
        region,
        listings.filter(
          (l) => l.region === knowledgeRegionOfScreening[region] && l.redFlagTier === 'red_flag',
        ).length,
      ]),
    );
    expect(counts).toEqual(stated);
    expect(Object.values(counts).every((n) => n > 0)).toBe(true);
  });

  it('keeps axial spondyloarthritis for a 52 year old whose pain started at 44', () => {
    const atOnset = listings.filter((l) => l.ageText?.toLowerCase().includes('onset'));
    expect(atOnset.map((l) => `${l.conditionId} ${l.region} ${l.ageText ?? ''}`).sort()).toEqual([
      'HIP-035 cervical Under 45 at onset',
      'LUM-015 lumbar_sij 10-20 (onset)',
      'LUM-020 lumbar_sij Under 45 at onset',
    ]);
    const ruledOut = (region: 'back' | 'neck', durationWeeks: number) =>
      shortlistCandidates(listings, patient({ region, age: 52, durationWeeks }), settings)
        .items.filter((i) => i.mustRuleOut)
        .map((i) => i.conditionId);
    expect(ruledOut('back', 8 * 52)).toContain('LUM-020');
    expect(ruledOut('neck', 8 * 52)).toContain('HIP-035');
    expect(ruledOut('back', 2)).not.toContain('LUM-020');
  });
});
