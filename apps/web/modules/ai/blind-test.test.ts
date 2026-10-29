import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '@clinic-mx/db';
import { fromCsv, toCsv } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlindTestError,
  compareBlindTest,
  makeSheets,
  readSheet,
  runBlindTest,
} from './blind-test';
import type { AiTransport } from './gateway/transport';
import type * as PreparationSheet from './preparation-sheet';

const version = { id: '00000000-0000-4000-8000-000000000c01', number: 3 };
const listing = (n: number) => ({
  conditionId: `KNE-${String(n).padStart(3, '0')}`,
  region: 'knee',
  rowNumber: n,
  name: n === 2 ? '’Quoted’ fake condition 2' : `Fake condition ${String(n)}`,
  ageMin: null,
  ageMax: null,
  ageText: null,
  onsets: [],
  onsetText: null,
  sex: null,
  sexText: null,
  redFlagTier: 'none',
  symptoms: null,
});
const db = vi.hoisted(() => ({
  latestKnowledgeVersion: vi.fn(),
  knowledgeListings: vi.fn(),
  blindTestSpend: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => ({
  latestKnowledgeVersion: db.latestKnowledgeVersion,
  knowledgeListings: db.knowledgeListings,
  blindTestSpend: db.blindTestSpend,
}));
const settings: Record<string, unknown> = {
  'ai.blind_test_cases_min': 2,
  'ai.blind_test_cases_max': 50,
  'ai.blind_test_budget_paise': 200000,
  'ai.blocked_providers': ['deepseek'],
  'ai.sheet_top_count': 3,
  'ai.sheet_also_consider_count': 2,
  'ai.candidates_min': 15,
  'ai.candidates_max': 25,
  'ai.must_rule_out_tiers': ['red_flag'],
  'ai.usd_rate_paise': 9650,
  'ai.similar_cases_min': 3,
  'ai.similar_cases_max': 5,
  'assessment.acute_weeks_below': 3,
  'assessment.chronic_weeks_above': 12,
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));
vi.mock('./gateway/transport', () => ({ defaultTransport: () => null }));
const gateway = vi.hoisted(() => ({ rankForBlindTest: vi.fn() }));
vi.mock('./gateway', () => gateway);
vi.mock('./preparation-sheet', async () => {
  const actual: typeof PreparationSheet = await vi.importActual('./preparation-sheet');
  return { rowsFor: actual.rowsFor };
});

const fakeDb = { execute: db.execute } as unknown as Db;
const transport = {} as AiTransport;
const theCase = (n: number) => ({
  ref: ['case', String(n).padStart(3, '0')].join('-'),
  case: {
    age: 30,
    sex: 'female',
    region: 'knee',
    symptoms: n === 1 ? ["'Clicking' on stairs"] : [`Fake symptom ${String(n)}`],
    durationWeeks: 4,
    sport: [],
    goal: null,
  },
  onset: null,
  painZones: [],
  confirmed: [`KNE-00${String(n)}`],
});
const config = (id: string, providers = ['provider-a']) => ({
  id,
  config: {
    model: `vendor/${id}`,
    providers,
    promptVersion: 'rank_diagnoses.v1',
    reasoningEffort: 'low',
    timeoutMs: 6000,
    maxTokens: 800,
  },
});

async function folder(cases: unknown[], candidates: unknown[] = [config('a'), config('b')]) {
  const dir = await mkdtemp(join(tmpdir(), 'blind-test-'));
  const casesPath = join(dir, 'cases.json');
  const candidatesPath = join(dir, 'candidates.json');
  await writeFile(casesPath, JSON.stringify({ cases }));
  await writeFile(candidatesPath, JSON.stringify({ candidates }));
  const outDir = join(dir, 'out');
  const run = (extra: { dryRun?: boolean; transport?: AiTransport | null } = {}) =>
    runBlindTest(fakeDb, { casesPath, candidatesPath, outDir, transport, ...extra });
  return { dir, casesPath, candidatesPath, outDir, run };
}

const sheetOf = async (outDir: string, file: string) =>
  fromCsv(await readFile(join(outDir, 'scoring', file), 'utf8'));
const keyOf = async (outDir: string) =>
  JSON.parse(await readFile(join(outDir, 'key.json'), 'utf8')) as Parameters<typeof readSheet>[2];
const scored = (rows: string[][]) => rows.map((row) => [...row.slice(0, 10), '4', 'no', '']);

// AI-06 done when: runs 30 to 50 anonymised cases through candidate models; clinicians score
// blind; results compared. Generated cases and listings only; the model's answer is mocked (the
// gateway's own tests cover zero data retention, pinning and the budget).
// Each test writes and reads real files in a temporary folder; on a busy machine (the local gate
// runs suites side by side) the first can take seconds, so this suite allows longer than the default.
describe('the blind test tool', { timeout: 30_000 }, () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), gateway.rankForBlindTest]) fn.mockReset();
    db.latestKnowledgeVersion.mockResolvedValue({ ...version, status: 'approved' });
    db.knowledgeListings.mockResolvedValue([1, 2, 3, 4, 5].map(listing));
    db.blindTestSpend.mockResolvedValue(0n);
    db.execute.mockResolvedValue([{ cost: '1200' }]);
    // Candidate a ranks the shortlist as given; b reverses it.
    gateway.rankForBlindTest.mockImplementation(
      (_db: unknown, call: { rows: { conditionId: string }[]; config: { model: string } }) => {
        const order = call.rows.map((_, i) => i + 1);
        if (call.config.model === 'vendor/b') order.reverse();
        return Promise.resolve({
          status: 'ok',
          runId: 'run',
          output: order.map((n) => ({
            n,
            conditionId: call.rows[n - 1]?.conditionId,
            reason: `Fake reason ${String(n)}`,
          })),
        });
      },
    );
  });

  it('runs every case through every candidate, then scores blind and compares', async () => {
    const f = await folder([theCase(1), theCase(5)]);
    expect(await f.run()).toEqual({ done: 4, capped: false });
    expect(gateway.rankForBlindTest).toHaveBeenCalledTimes(4);
    // Resuming does nothing twice.
    await f.run();
    expect(gateway.rankForBlindTest).toHaveBeenCalledTimes(4);

    expect(
      await makeSheets(fakeDb, { casesPath: f.casesPath, outDir: f.outDir, scorers: 2, seed: 7 }),
    ).toEqual({ sheets: 2, rows: 4 });
    const sheet = await readFile(join(f.outDir, 'scoring', 'scorer-1.csv'), 'utf8');
    expect(sheet.startsWith('﻿')).toBe(true);
    expect(sheet).not.toContain('vendor/');
    expect(sheet).toContain('Fake condition 1');
    const [, ...rows] = await sheetOf(f.outDir, 'scorer-1.csv');
    // A check a spreadsheet keeps as text.
    expect(rows.every((row) => /^k-[0-9a-f]{12}$/.test(row[2] ?? ''))).toBe(true);
    for (const scorer of ['scorer-1.csv', 'scorer-2.csv']) {
      const [header, ...body] = await sheetOf(f.outDir, scorer);
      await writeFile(
        join(f.outDir, 'scoring', 'returned', scorer),
        toCsv(header ?? [], scored(body)),
      );
    }
    const reference = await compareBlindTest(fakeDb, { casesPath: f.casesPath, outDir: f.outDir });
    expect(reference).toMatch(
      /^Blind test \d{4}-\d{2}-\d{2}, run [0-9a-f]{8}, report sha256 [0-9a-f]{12}$/,
    );
    const report = await readFile(join(f.outDir, 'report.md'), 'utf8');
    // a ranks KNE-001 first for case 1 and KNE-005 fifth for case 5; b the other way round.
    expect(report).toContain('| a | 50% | 50% | 100% | 0% |');
    expect(report).toContain('| b | 50% | 50% | 100% | 0% |');
    expect(report).toContain('4.00');
    expect((await readdir(f.outDir)).sort()).toEqual([
      'key.json',
      'outputs',
      'report.json',
      'report.md',
      'run.json',
      'scoring',
    ]);
  });

  // AI-05: as the sheet draws similar cases from other patients, each case draws them from the
  // file's other cases, never itself, so its own answer is never in view.
  it('sends each case the other cases as its similar confirmed cases', async () => {
    const f = await folder([1, 2, 3, 4].map(theCase));
    await f.run();
    const calls = gateway.rankForBlindTest.mock.calls as [
      unknown,
      { case: { symptoms: string[] }; similar: { confirmed: string }[] },
    ][];
    expect(calls).toHaveLength(8);
    for (const [, call] of calls) {
      const own = Number(/\d+$/.exec(call.case.symptoms[0] ?? '')?.[0] ?? 1);
      expect(call.similar).toHaveLength(3);
      expect(call.similar.map((s) => s.confirmed)).not.toContain(listing(own).name);
    }
    // Two cases leave each one only one other: under the minimum, none.
    gateway.rankForBlindTest.mockClear();
    await (await folder([theCase(1), theCase(2)])).run();
    const two = gateway.rankForBlindTest.mock.calls as [unknown, { similar: unknown[] }][];
    expect(two.every(([, call]) => call.similar.length === 0)).toBe(true);
  });

  it('refuses identifiers, unknown diagnoses, blocked providers and a changed folder', async () => {
    const named = { ...theCase(1), case: { ...theCase(1).case, symptoms: ['Call 98765 43210'] } };
    for (const [cases, candidates, message] of [
      [[named, theCase(2)], [config('a'), config('b')], 'looks like an identifier'],
      [
        [{ ...theCase(1), confirmed: ['HIP-001'] }, theCase(2)],
        [config('a'), config('b')],
        'not in this knowledge base',
      ],
      [[theCase(1), theCase(2)], [config('a'), config('b', ['DeepSeek'])], 'blocked provider'],
      [[theCase(1)], [config('a'), config('b')], 'runs 2 to 50 cases'],
    ] as const) {
      await expect((await folder([...cases], [...candidates])).run()).rejects.toThrow(message);
    }
    const f = await folder([theCase(1), theCase(2)]);
    await f.run();
    await writeFile(f.casesPath, JSON.stringify({ cases: [theCase(1), theCase(3)] }));
    await expect(f.run()).rejects.toThrow('another run');
    expect(gateway.rankForBlindTest).toHaveBeenCalledTimes(4);
  });

  it('never mixes a dry run with a real one, and never makes a dry run a gate reference', async () => {
    const f = await folder([theCase(1), theCase(2)]);
    expect(await f.run({ dryRun: true, transport: undefined })).toEqual({ done: 4, capped: false });
    expect(gateway.rankForBlindTest).not.toHaveBeenCalled();
    await expect(f.run()).rejects.toThrow('another run');
    await makeSheets(fakeDb, { casesPath: f.casesPath, outDir: f.outDir, scorers: 1 });
    const [header, ...body] = await sheetOf(f.outDir, 'scorer-1.csv');
    await writeFile(
      join(f.outDir, 'scoring', 'returned', 'scorer-1.csv'),
      toCsv(header ?? [], scored(body)),
    );
    expect(await compareBlindTest(fakeDb, { casesPath: f.casesPath, outDir: f.outDir })).toMatch(
      /^Dry run/,
    );
    expect(await readFile(join(f.outDir, 'report.md'), 'utf8')).toMatch(/^DRY RUN/);
  });

  it('needs a key for a real run, and saves nothing a model did not answer', async () => {
    const f = await folder([theCase(1), theCase(2)]);
    await expect(f.run({ transport: undefined })).rejects.toThrow('OPENROUTER_API_KEY');
    gateway.rankForBlindTest.mockResolvedValueOnce({
      status: 'unavailable',
      reason: 'not_configured',
      runId: 'run',
    });
    await expect(f.run()).rejects.toThrow('could not be called');
    expect(await readdir(join(f.outDir, 'outputs'))).toEqual([]);
  });

  it('stops at the budget and says how to go on', async () => {
    const f = await folder([theCase(1), theCase(2)]);
    gateway.rankForBlindTest.mockResolvedValueOnce({
      status: 'unavailable',
      reason: 'capped',
      runId: 'run',
    });
    expect(await f.run()).toEqual({ done: 0, capped: true });
    db.blindTestSpend.mockResolvedValue(30_000_000n);
    await expect(f.run()).rejects.toThrow('Raise it to continue');
    await expect(
      makeSheets(fakeDb, { casesPath: f.casesPath, outDir: f.outDir, scorers: 1 }),
    ).rejects.toThrow('not finished');
  });

  it('keeps the key once issued, and reads each returned sheet against it', async () => {
    const f = await folder([theCase(1), theCase(2)]);
    await f.run();
    await makeSheets(fakeDb, { casesPath: f.casesPath, outDir: f.outDir, scorers: 1 });
    const key = await keyOf(f.outDir);
    const [header, ...body] = await sheetOf(f.outDir, 'scorer-1.csv');
    // A third scorer later: the same labels.
    await makeSheets(fakeDb, { casesPath: f.casesPath, outDir: f.outDir, scorers: 3 });
    expect(await keyOf(f.outDir)).toEqual({ ...key, scorers: 3 });
    expect(readSheet(toCsv(header ?? [], scored(body)), 'scorer-1.csv', key)).toHaveLength(4);
    // Read against another key, the same sheet is refused.
    const other = { ...key, seed: key.seed + 1 };
    expect(() => readSheet(toCsv(header ?? [], scored(body)), 'scorer-1.csv', other)).toThrow(
      'was changed',
    );
    // Edited, short, doubled or unscored: refused.
    const [first, ...rest] = scored(body);
    const edited = [...(first ?? []).slice(0, 9), 'Something else', '4', 'no', ''];
    for (const [rows, message] of [
      [[edited, ...rest], 'was changed'],
      [rest, 'exactly once'],
      [[first ?? [], first ?? [], ...rest.slice(1)], 'exactly once'],
      [[[...(first ?? []).slice(0, 10), '7', 'maybe', ''], ...rest], 'usefulness 1 to 5'],
    ] as const) {
      expect(() => readSheet(toCsv(header ?? [], [...rows]), 'scorer-1.csv', key)).toThrow(message);
    }
  });

  it('refuses the same returned sheet twice', async () => {
    const f = await folder([theCase(1), theCase(2)]);
    await f.run();
    await makeSheets(fakeDb, { casesPath: f.casesPath, outDir: f.outDir, scorers: 1 });
    const [header, ...body] = await sheetOf(f.outDir, 'scorer-1.csv');
    for (const name of ['scorer-1.csv', 'scorer-1 copy.csv']) {
      await writeFile(
        join(f.outDir, 'scoring', 'returned', name),
        toCsv(header ?? [], scored(body)),
      );
    }
    await expect(
      compareBlindTest(fakeDb, { casesPath: f.casesPath, outDir: f.outDir }),
    ).rejects.toThrow(BlindTestError);
  });
});
