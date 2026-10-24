import { beforeAll, describe, expect, it } from 'vitest';
import { buildKnowledge, KnowledgeImportError, type ConditionIds } from './build';
import { buildReport, reportMarkdown } from './report';
import { readConditionIds, readReport, readRulesFile, WORKBOOK_FOLDER_PATH } from './paths';
import { buildObjective } from './objective';
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
    expect(reportMarkdown(buildReport(workbooks, first, redFlags, buildObjective(workbooks)))).toBe(
      await readReport(),
    );
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

// CLN-05: each workbook's measures (Progress Tracker) and special tests, read as the workbook's
// formulas compute them; anything unknown stops the import.
describe('the Objective’s measures and special tests', () => {
  const measure = (key: string) => {
    const found = buildObjective(workbooks).measures.find((m) => m.key === key);
    if (!found) throw new Error(`no measure ${key}`);
    return found;
  };

  it('reads LSI rows at the workbook’s target, a timed hop inverted, the heel raise’s count', () => {
    expect(measure('knee.lsi.quadriceps')).toMatchObject({
      name: 'Quadriceps',
      unit: 'kg',
      kind: 'lsi',
      inverted: false,
      rule: { kind: 'lsi', passAt: 0.9 },
    });
    expect(measure('knee.lsi.6_m_timed_hop')).toMatchObject({ unit: 'sec', inverted: true });
    expect(measure('foot_ankle.lsi.single_leg_heel_raise_repetitions').rule).toEqual({
      kind: 'lsi',
      passAt: 0.9,
      minInvolved: 25,
    });
  });

  it('reads range deficits with each workbook’s bands, and values against a reference', () => {
    expect(measure('elbow.deficit.flexion').rule).toEqual({
      kind: 'deficit',
      absolute: true,
      okAt: 5,
      mildAt: 15,
      okWord: 'symmetrical',
    });
    expect(measure('foot_ankle.deficit.ankle_plantarflexion').rule).toMatchObject({
      okAt: 1,
      mildAt: 3,
    });
    expect(measure('cervical.reference.rotation_left').rule).toEqual({
      kind: 'reference_deficit',
      reference: 80,
      okAt: 5,
      mildAt: 20,
      okWord: 'full',
    });
    expect(
      measure('cervical.reference.joint_position_error_head_repositioning_eyes_closed').rule,
    ).toEqual({ kind: 'reference_target', reference: 4.5, passWhen: 'at_most' });
  });

  it('reads markers with their direction, and the 0 to 3 items as grades', () => {
    expect(measure('knee.marker.effusion_grade_0_3')).toMatchObject({
      kind: 'grade',
      unit: 'grade',
      direction: 'Lower is better',
    });
    const grades = buildObjective(workbooks).measures.filter((m) => m.kind === 'grade');
    expect(grades.every((m) => m.name.includes('(0-3)'))).toBe(true);
    expect(grades.length).toBe(10);
  });

  it('reads each Special Tests row, keeping the category above when a row leaves it empty', () => {
    const { specialTests } = buildObjective(workbooks);
    const lachman = specialTests.find((t) => t.region === 'knee' && t.test.startsWith('Lachman'));
    expect(lachman).toMatchObject({
      category: 'Ligament',
      targets: 'ACL',
      positiveFinding: 'Increased anterior translation with a soft end-feel',
    });
    expect(specialTests.some((t) => t.region === 'bone_stress')).toBe(false);
    expect(specialTests.every((t) => t.category !== '')).toBe(true);
  });

  it('stops on a header or formula it does not know', () => {
    const books = copy();
    const knee = books.find((w) => w.region === 'knee');
    const header = knee?.tracker.find((row) => row.cells[0]?.text === 'Measure');
    const quadriceps = knee?.tracker.find((row) => row.cells[0]?.text === 'Quadriceps');
    if (!header?.cells[1] || !quadriceps?.cells[4]) throw new Error('no knee rows');
    header.cells[1].text = 'Left';
    quadriceps.cells[4].formula = 'B12*C12';
    const problems = problemsOf(() => buildObjective(books));
    expect(problems.some((p) => p.includes('the header "Left | Uninvolved" is not known'))).toBe(
      true,
    );
  });
});
