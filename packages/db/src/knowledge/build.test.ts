import { beforeAll, describe, expect, it } from 'vitest';
import { buildKnowledge, KnowledgeImportError, type ConditionIds } from './build';
import { buildCategories } from './categories';
import { buildPlanCatalog } from './plan-catalog';
import { buildReport, reportMarkdown } from './report';
import {
  readCategoriesFile,
  readConditionIds,
  readPlanCatalogFile,
  readReport,
  readRulesFile,
  WORKBOOK_FOLDER_PATH,
} from './paths';
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
    const categories = buildCategories(await readCategoriesFile(), first);
    expect(
      reportMarkdown(
        buildReport(
          workbooks,
          first,
          redFlags,
          buildObjective(workbooks),
          categories,
          buildPlanCatalog(await readPlanCatalogFile()),
        ),
      ),
    ).toBe(await readReport());
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

// OUT-08 (user decisions 27 October 2026): each workbook's readiness section, one criterion per
// line, word for word.
describe('the readiness criteria', () => {
  const of = (region: string) =>
    buildObjective(workbooks).readiness.filter((c) => c.region === region);

  it('reads knee: the strength and hop measures by their rules, then the four yes or no lines', () => {
    const knee = of('knee');
    expect(knee.map((c) => [c.text, c.kind, c.rule.kind])).toEqual([
      ['Quadriceps', 'measure', 'measure'],
      ['Hamstrings', 'measure', 'measure'],
      ['Hip abductors', 'measure', 'measure'],
      ['Hip external rotators', 'measure', 'measure'],
      ['Calf (heel-raise reps)', 'measure', 'measure'],
      ['Single hop for distance', 'measure', 'measure'],
      ['Triple hop for distance', 'measure', 'measure'],
      ['Crossover hop for distance', 'measure', 'measure'],
      ['6 m timed hop', 'measure', 'measure'],
      ['No dynamic valgus on single-leg tasks and landing', 'check', 'yes'],
      ['Sport-specific progression completed', 'check', 'yes'],
      ['Psychological readiness demonstrated (e.g. ACL-RSI)', 'check', 'yes'],
      ['Graded return plan with load monitoring in place', 'check', 'yes'],
    ]);
    expect(knee[0]?.measureKey).toBe('knee.lsi.quadriceps'); // gitleaks:allow
  });

  it('reads lumbar: the screen, targets, MCID with its direction, and the safety netting', () => {
    const lumbar = of('lumbar_sij');
    const rule = (text: string) => lumbar.find((c) => c.text === text)?.rule;
    expect(rule('Red flags positive')).toEqual({ kind: 'none_positive' });
    expect(rule('SITTING tolerance')).toEqual({ kind: 'target', target: 60 });
    expect(rule('OSWESTRY DISABILITY INDEX')).toEqual({ kind: 'mcid', mcid: 10, better: 'lower' });
    expect(rule('Patient-Specific Functional Scale')).toEqual({
      kind: 'mcid',
      mcid: 2,
      better: 'higher',
    });
    expect(lumbar.at(-1)).toMatchObject({
      text: 'WRITTEN cauda equina safety-netting advice given and documented?',
      fromVerdict: true,
      rule: { kind: 'yes' },
    });
  });

  it('adds the yes or no rows only the overall verdict names, after the section', () => {
    const bone = of('bone_stress');
    expect(bone.filter((c) => c.fromVerdict).map((c) => c.rowNumber)).toEqual([12, 13, 14, 15]);
    expect(bone.at(-1)?.section).toBe(
      'ENTRY GATES — ALL MUST READ YES BEFORE IMPACT LOADING BEGINS',
    );
  });

  it('gives every region criteria with unique keys, and stops on a line it does not know', () => {
    const { readiness } = buildObjective(workbooks);
    expect(new Set(readiness.map((c) => c.region)).size).toBe(9);
    for (const region of new Set(readiness.map((c) => c.region))) {
      const keys = readiness.filter((c) => c.region === region).map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    const books = copy();
    const knee = books.find((w) => w.region === 'knee');
    const line = knee?.tracker.find((row) => row.cells[0]?.text === 'Hop tests passed');
    if (!line?.cells[1]) throw new Error('no knee readiness line');
    line.cells[1].formula = 'SUM(E20:E23)';
    expect(
      problemsOf(() => buildObjective(books)).some((p) =>
        p.includes('the readiness line "Hop tests passed" matches nothing known'),
      ),
    ).toBe(true);
  });
});

// OUT-04 with SET-09 (user decisions 27 October 2026): each Phased Programme sheet's phases, each
// Exit Criteria cell split on ";" into lines word for word; none for the Bone Stress workbook.
describe('the phased programmes', () => {
  it('reads Phase 0 to 4 of eight regions, each exit line word for word', () => {
    const { phases, phaseCriteria } = buildObjective(workbooks);
    expect(phases).toHaveLength(40);
    expect(new Set(phases.map((p) => p.region)).size).toBe(8);
    expect(phases.some((p) => p.region === 'bone_stress')).toBe(false);
    const knee = phases.filter((p) => p.region === 'knee');
    expect(knee.map((p) => [p.number, p.name])).toEqual([
      [0, 'Screen & Protect'],
      [1, 'Restore & Activate'],
      [2, 'Build Capacity'],
      [3, 'Energy Storage & Power'],
      [4, 'Sport & Discharge'],
    ]);
    expect(
      phaseCriteria.filter((c) => c.region === 'knee' && c.phase === 1).map((c) => c.text),
    ).toEqual([
      'Full or near-full range',
      'pain <=5/10 on loading settling within 24 h',
      'no extension lag',
    ]);
    expect(new Set(phaseCriteria.map((c) => c.key)).size).toBe(phaseCriteria.length);
  });

  it('flags the lines naming acceptable pain on loading for the decision 4 hint', () => {
    const { phaseCriteria } = buildObjective(workbooks);
    expect(
      phaseCriteria.filter((c) => c.namesPainLimit).map((c) => [c.region, c.phase, c.text]),
    ).toEqual([
      ['shoulder', 1, 'loading into acceptable pain (<=5/10 settling within 24 h)'],
      ['elbow', 1, 'loading into acceptable pain (<=5/10 settling within 24 h)'],
      ['forearm_wrist', 1, 'loading into acceptable pain'],
      ['hip', 1, 'Pain-free or acceptable-pain loading established'],
      ['knee', 1, 'pain <=5/10 on loading settling within 24 h'],
      ['foot_ankle', 1, 'loading into acceptable pain'],
    ]);
  });

  it('stops on a header or phase row it does not know', () => {
    const books = copy();
    const knee = books.find((w) => w.region === 'knee');
    const sheet = knee?.phased;
    if (!sheet?.rows[2]) throw new Error('no knee phased programme');
    sheet.rows[2].cells[0] = 'Phase 2a';
    expect(problemsOf(() => buildObjective(books))).toEqual([
      '5 Knee_Assessment_and_Management_Programme.xlsx, Phased Programme row 6: "Phase 2a" is not Phase 2.',
    ]);
    sheet.rows[2].cells[0] = 'Phase 2';
    sheet.header[6] = 'Exit';
    expect(problemsOf(() => buildObjective(books))[0]).toContain('is not the one read');
  });
});
