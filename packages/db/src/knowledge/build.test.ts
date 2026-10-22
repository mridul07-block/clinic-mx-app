import { beforeAll, describe, expect, it } from 'vitest';
import { buildKnowledge, KnowledgeImportError, type ConditionIds } from './build';
import { buildReport, reportMarkdown } from './report';
import { readConditionIds, readReport, readRulesFile, WORKBOOK_FOLDER_PATH } from './paths';
import { buildRedFlags } from './red-flags';
import { readWorkbooks, type Workbook } from './workbook';

// SET-05 done when: stable condition IDs; normalised age, onset, sex, tags, red flag tier;
// duplicates merged; import report. These read the real workbooks.
let workbooks: Workbook[];
let ids: ConditionIds;

beforeAll(async () => {
  workbooks = await readWorkbooks(WORKBOOK_FOLDER_PATH);
  ids = await readConditionIds();
}, 60_000);

const copy = () => structuredClone(workbooks);
/** Sets one cell of a copied workbook: a row's cell, or the header when `row` is 'header'. */
function setCell(
  books: Workbook[],
  book: number,
  row: number | 'header',
  column: number,
  text: string,
) {
  const workbook = books[book];
  if (!workbook) throw new Error(`no workbook ${book}`);
  const cells = row === 'header' ? workbook.header : workbook.rows[row]?.cells;
  if (!cells) throw new Error(`no row ${row}`);
  cells[column] = text;
}
const problemsOf = (run: () => unknown): string[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof KnowledgeImportError) return error.problems;
    throw error;
  }
  throw new Error('The import did not stop.');
};

describe('the knowledge base import', () => {
  it('reads every row of the nine workbooks into 345 conditions', () => {
    const built = buildKnowledge(workbooks, ids);
    expect(workbooks.map((w) => w.rows.length)).toEqual([40, 38, 39, 38, 40, 41, 41, 38, 39]);
    expect(built.listings).toHaveLength(354);
    expect(built.conditions).toHaveLength(345);
    expect(built.assigned).toEqual([]);
    expect(built.unmatched).toEqual([]);
  });

  it('merges the conditions two workbooks share, keeping both texts', () => {
    const built = buildKnowledge(workbooks, ids);
    const merged = built.conditions
      .filter((c) => built.listings.filter((l) => l.conditionId === c.conditionId).length === 2)
      .map((c) => c.name);
    expect(merged).toEqual([
      'Pronator Syndrome (Median Nerve at the Elbow)',
      'Acute Compartment Syndrome of the Forearm',
      'Meralgia Paraesthetica (Lateral Femoral Cutaneous Nerve)',
      'Sacroiliac Joint Pain',
      'Axial Spondyloarthritis',
      'Meniscal Root Tear',
      'Discoid Meniscus',
      'Cervical Radiculopathy',
      'Thoracic Outlet Syndrome',
    ]);
    const radiculopathy = built.listings.filter(
      (l) => l.conditionId === ids['shoulder|Cervical Radiculopathy'],
    );
    expect(radiculopathy.map((l) => l.region)).toEqual(['shoulder', 'cervical']);
    expect(radiculopathy[0]?.symptoms).not.toEqual(radiculopathy[1]?.symptoms);
  });

  it('reads age, onset, sex, tags and the red flag tier of every row', () => {
    const { listings } = buildKnowledge(workbooks, ids);
    const tiers: Record<string, number> = {};
    for (const l of listings) tiers[l.redFlagTier] = (tiers[l.redFlagTier] ?? 0) + 1;
    expect(tiers).toEqual({
      none: 64,
      screen: 126,
      conditional: 20,
      red_flag: 105,
      not_stated: 39,
    });
    const regional = listings.filter((l) => l.region !== 'bone_stress');
    expect(regional.every((l) => l.sex !== null && l.onsets.length > 0)).toBe(true);
    const impingement = listings.find((l) => l.name === 'Subacromial Impingement (now: RCRSP)');
    expect(impingement).toMatchObject({
      conditionId: 'SHO-001',
      subregion: 'Anterior',
      ageMin: 20,
      ageMax: 60,
      onsets: ['gradual'],
      sex: 'equal',
      redFlagTier: 'none',
      discriminatingQuestion: 'Does lifting the arm overhead increase pain?',
    });
    expect(impingement?.activityTags).toEqual(expect.arrayContaining(['overhead', 'sedentary']));
    expect(impingement?.details.evidence_anchor?.text).toContain('GRASP');
    const femoralNeck = listings.find((l) => l.region === 'bone_stress' && l.rowNumber === 4);
    expect(femoralNeck).toMatchObject({
      redFlagTier: 'not_stated',
      riskClass: 'HIGH RISK',
      sex: null,
    });
  });

  it('gives the same IDs and the committed report every time', async () => {
    const first = buildKnowledge(workbooks, ids);
    expect(buildKnowledge(copy(), ids)).toEqual(first);
    expect(first.ids).toEqual(ids);
    const redFlags = buildRedFlags(workbooks, await readRulesFile());
    expect(reportMarkdown(buildReport(workbooks, first, redFlags))).toBe(await readReport());
  });

  it('stops on a row the ID file does not know, unless assigning', () => {
    const renamed = copy();
    setCell(renamed, 0, 0, 7, 'Subacromial Pain Syndrome');
    expect(problemsOf(() => buildKnowledge(renamed, ids))).toEqual([
      expect.stringContaining('"Subacromial Pain Syndrome" has no condition ID'),
    ]);
    const built = buildKnowledge(renamed, ids, { assign: true });
    expect(built.assigned).toEqual([
      { key: 'shoulder|Subacromial Pain Syndrome', conditionId: 'SHO-041' },
    ]);
    expect(built.unmatched).toEqual([
      { key: 'shoulder|Subacromial Impingement (now: RCRSP)', conditionId: 'SHO-001' },
    ]);
  });

  it('joins a new row to a condition another workbook names the same', () => {
    const books = copy();
    setCell(books, 1, 0, 6, 'Frozen Shoulder');
    const built = buildKnowledge(books, ids, { assign: true });
    expect(built.assigned).toEqual([
      {
        key: 'elbow|Frozen Shoulder',
        conditionId: ids['shoulder|Frozen Shoulder (Adhesive Capsulitis)'],
      },
    ]);
  });

  it('stops on an unknown column or a value it cannot read', () => {
    const books = copy();
    setCell(books, 0, 'header', 7, 'Diagnosis');
    setCell(books, 1, 0, 3, 'adults');
    setCell(books, 2, 0, 14, 'Possibly');
    const problems = problemsOf(() => buildKnowledge(books, ids));
    expect(problems).toEqual([
      expect.stringContaining('unknown column "Diagnosis"'),
      expect.stringContaining('age "adults" cannot be read'),
      expect.stringContaining('red flag status "Possibly" cannot be read'),
    ]);
  });

  it('reads each workbook’s Red Flags sheet: presentations, then screening notes', async () => {
    const { presentations, rules } = buildRedFlags(workbooks, await readRulesFile());
    const counts = Object.fromEntries(
      workbooks.map((w) => {
        const own = presentations.filter((p) => p.region === w.region);
        return [w.region, [own.filter((p) => p.kind === 'presentation').length, own.length]];
      }),
    );
    expect(counts).toEqual({
      shoulder: [12, 16],
      elbow: [12, 16],
      forearm_wrist: [12, 17],
      hip: [12, 16],
      knee: [8, 11],
      foot_ankle: [12, 17],
      cervical: [12, 17],
      lumbar_sij: [12, 18],
      bone_stress: [8, 8],
    });
    expect(presentations.find((p) => p.region === 'lumbar_sij' && p.rowNumber === 4)).toMatchObject(
      {
        kind: 'presentation',
        presentation: 'CAUDA EQUINA SYNDROME',
      },
    );
    expect(presentations.find((p) => p.kind === 'screening_note')?.presentation).not.toMatch(/^•/);
    expect(rules.length).toBe(20);
  });

  it('stops on a broken rules file or an unknown Red Flags column', async () => {
    const text = await readRulesFile();
    expect(problemsOf(() => buildRedFlags(workbooks, '[{"key": "x"}'))).toEqual([
      expect.stringContaining('not valid JSON'),
    ]);
    const unknownQuestion = text.replace('"calf_chest_breath"', '"calf_ache"');
    expect(problemsOf(() => buildRedFlags(workbooks, unknownQuestion)).length).toBeGreaterThan(0);
    const books = copy();
    const sheet = books[0]?.redFlags;
    if (!sheet) throw new Error('no Red Flags sheet');
    sheet.header[1] = 'Signs';
    expect(problemsOf(() => buildRedFlags(books, text))).toEqual([
      expect.stringContaining('unknown column "Signs"'),
      expect.stringContaining('no column for "features"'),
    ]);
  });
});
