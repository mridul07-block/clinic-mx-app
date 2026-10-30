import 'server-only';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  blindTestSpend,
  knowledgeListings,
  latestKnowledgeVersion,
  type Db,
  type KnowledgeListing,
} from '@clinic-mx/db';
import {
  SHEET_COLUMNS,
  assignLabels,
  blindTestCandidateCase,
  blindTestCandidateFileSchema,
  blindTestCaseFileSchema,
  blindTestMetrics,
  blindTestReport,
  blindTestScoreSchema,
  durationLabel,
  fromCsv,
  microUsdToPaise,
  namesBlockedProvider,
  seededRandom,
  shortlistCandidates,
  similarCases,
  toCsv,
  validateRanking,
  type AiPromptVersion,
  type BlindTestCase,
  type BlindTestOutput,
  type BlindTestScore,
} from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { getSetting } from '../settings/settings';
import { rankForBlindTest, type ShortlistRow } from './gateway';
import { outboundAllowed, textsOf } from './gateway/guard';
import { PROMPTS } from './gateway/prompts';
import { defaultTransport, type AiTransport } from './gateway/transport';
import { rowsFor } from './preparation-sheet';

/**
 * The blind test (AI-06; docs/runbooks/ai-blind-test.md): an operator tool, run with
 * `pnpm ai:blind-test`. `run` sends the client's anonymised cases through each candidate model
 * exactly as the preparation sheet does (shortlist, rank, validate), one pair at a time, saving as
 * it goes so a stopped run resumes. `sheets` gives each clinician a scoring sheet with the models
 * hidden behind labels shuffled per case. `compare` reads the sheets back and lays the candidates
 * side by side. Everything is kept in the operator's folder outside the repository; only counts
 * are printed. No pass mark: the clinicians decide (AI-09 records it).
 */
export class BlindTestError extends Error {
  override name = 'BlindTestError';
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
const exists = async (path: string) =>
  readFile(path, 'utf8').then(
    () => true,
    () => false,
  );

interface RunRecord {
  runId: string;
  kbVersionId: string;
  kbVersionNumber: number;
  promptVersion: string;
  casesSha256: string;
  candidatesSha256: string;
  candidates: string[];
  top: number;
  alsoConsider: number;
  dryRun: boolean;
  startedAt: string;
}

/** The case file, checked: the fields allowed, the count, nothing identifying, IDs that exist. */
export async function loadCases(
  path: string,
  listings: readonly KnowledgeListing[],
  options: { dryRun: boolean },
): Promise<{ cases: BlindTestCase[]; sha256: string }> {
  const text = await readFile(path, 'utf8');
  const parsed = blindTestCaseFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new BlindTestError(
      `The case file is not valid: ${parsed.error.issues[0]?.message ?? ''}`,
    );
  }
  const { cases } = parsed.data;
  const [min, max] = [
    await getSetting('ai.blind_test_cases_min'),
    await getSetting('ai.blind_test_cases_max'),
  ];
  if (!options.dryRun && (cases.length < min || cases.length > max)) {
    throw new BlindTestError(
      `A blind test runs ${String(min)} to ${String(max)} cases, not ${String(cases.length)}.`,
    );
  }
  const known = new Set(listings.map((l) => l.conditionId));
  for (const c of cases) {
    if (!outboundAllowed([...textsOf(c.case), ...c.painZones])) {
      throw new BlindTestError(`${c.ref} holds something that looks like an identifier.`);
    }
    const unknown = c.confirmed.find((id) => !known.has(id));
    if (unknown)
      throw new BlindTestError(`${c.ref} confirms ${unknown}, not in this knowledge base version.`);
  }
  return { cases, sha256: sha256(text) };
}

/** Sends every case through every candidate, resuming where a stopped run left off. */
export async function runBlindTest(
  db: Db,
  options: {
    casesPath: string;
    candidatesPath: string;
    outDir: string;
    kbVersionNumber?: number;
    dryRun?: boolean;
    transport?: AiTransport | null;
    log?: (line: string) => void;
  },
): Promise<{ done: number; capped: boolean }> {
  const log = options.log ?? (() => undefined);
  const dryRun = options.dryRun ?? false;
  const version =
    options.kbVersionNumber === undefined
      ? await latestKnowledgeVersion(db)
      : (
          await db.execute<{ id: string; number: number }>(
            sql`select id, number from kb_version where number = ${options.kbVersionNumber}`,
          )
        )[0];
  if (!version) throw new BlindTestError('That knowledge base version was not found.');
  const listings = await knowledgeListings(db, version.id);
  const { cases, sha256: casesSha256 } = await loadCases(options.casesPath, listings, { dryRun });
  const candidatesText = await readFile(options.candidatesPath, 'utf8');
  const parsedCandidates = blindTestCandidateFileSchema.safeParse(JSON.parse(candidatesText));
  if (!parsedCandidates.success) {
    throw new BlindTestError(
      `The candidate file is not valid: ${parsedCandidates.error.issues[0]?.message ?? ''}`,
    );
  }
  const candidates = parsedCandidates.data.candidates;
  const blocked = await getSetting('ai.blocked_providers');
  for (const candidate of candidates) {
    if (namesBlockedProvider(candidate.config.providers, blocked)) {
      throw new BlindTestError(`${candidate.id} names a blocked provider.`);
    }
  }

  const transport =
    options.transport === undefined ? (dryRun ? null : defaultTransport()) : options.transport;
  if (!dryRun && !transport) {
    throw new BlindTestError('Set OPENROUTER_API_KEY first: a real run calls the models.');
  }

  await mkdir(join(options.outDir, 'outputs'), { recursive: true });
  const runPath = join(options.outDir, 'run.json');
  const top = await getSetting('ai.sheet_top_count');
  const alsoConsider = await getSetting('ai.sheet_also_consider_count');
  let record: RunRecord;
  if (await exists(runPath)) {
    record = (await readJson(runPath)) as RunRecord;
    if (
      record.casesSha256 !== casesSha256 ||
      record.candidatesSha256 !== sha256(candidatesText) ||
      record.kbVersionId !== version.id ||
      record.dryRun !== dryRun
    ) {
      throw new BlindTestError(
        'This folder holds another run (the files, the version, or a dry run): use a new folder.',
      );
    }
  } else {
    record = {
      runId: randomUUID(),
      kbVersionId: version.id,
      kbVersionNumber: version.number,
      promptVersion: [...new Set(candidates.map((c) => c.config.promptVersion))].join(', '),
      casesSha256,
      candidatesSha256: sha256(candidatesText),
      candidates: candidates.map((c) => c.id),
      top,
      alsoConsider,
      dryRun,
      startedAt: new Date().toISOString(),
    };
    await writeJson(runPath, record);
  }

  const settings = {
    min: await getSetting('ai.candidates_min'),
    max: await getSetting('ai.candidates_max'),
    mustRuleOutTiers: await getSetting('ai.must_rule_out_tiers'),
  };
  const rate = await getSetting('ai.usd_rate_paise');
  const budgetReached = new BlindTestError(
    'The run reached ai.blind_test_budget_paise. Raise it to continue in this folder, or start a new folder.',
  );
  if (
    !dryRun &&
    microUsdToPaise(await blindTestSpend(db, record.runId), rate) >=
      BigInt(await getSetting('ai.blind_test_budget_paise'))
  ) {
    throw budgetReached;
  }
  // AI-05: each case's similar confirmed cases are the file's other cases, as the sheet draws them
  // from other patients (never the case itself, so its own answer is never in view).
  const similarSettings = {
    min: await getSetting('ai.similar_cases_min'),
    max: await getSetting('ai.similar_cases_max'),
    stage: {
      acuteWeeksBelow: await getSetting('assessment.acute_weeks_below'),
      chronicWeeksAbove: await getSetting('assessment.chronic_weeks_above'),
    },
  };
  const pool = cases.flatMap((c) => {
    const conditionId = c.confirmed[0] ?? '';
    const listing = listings.find((l) => l.conditionId === conditionId);
    return listing
      ? [
          {
            episodeId: c.ref,
            patientId: c.ref,
            case: blindTestCandidateCase(c),
            conditionId,
            conditionName: listing.name,
            confirmedAt: new Date(0),
          },
        ]
      : [];
  });
  let done = 0;
  for (const c of cases) {
    const shortlist = shortlistCandidates(listings, blindTestCandidateCase(c), settings);
    const rows: ShortlistRow[] = rowsFor(shortlist, listings);
    const similar = similarCases(
      { case: blindTestCandidateCase(c), patientId: c.ref, episodeId: c.ref },
      pool,
      rows,
      similarSettings,
    );
    const items = shortlist.items.filter((i) => rows.some((r) => r.conditionId === i.conditionId));
    const onShortlist = items.some((i) => c.confirmed.includes(i.conditionId));
    // A different order per case, so no model always goes first.
    const order = candidates.toSorted((a, b) =>
      sha256(`${c.ref}:${a.id}`).localeCompare(sha256(`${c.ref}:${b.id}`)),
    );
    for (const candidate of order) {
      const path = join(options.outDir, 'outputs', `${c.ref}.${candidate.id}.json`);
      if (await exists(path)) continue;
      const started = Date.now();
      let output: BlindTestOutput;
      if (dryRun) {
        output = {
          ref: c.ref,
          candidate: candidate.id,
          status: 'ok',
          suggestions: validateRanking(
            items,
            items.map((_, i) => ({ n: i + 1, reason: 'Dry run' })),
            { top, alsoConsider },
          ),
          onShortlist,
          latencyMs: 0,
          costPaise: null,
        };
      } else {
        const result = await rankForBlindTest(db, {
          runId: record.runId,
          kbVersionId: version.id,
          case: c.case,
          rows,
          similar,
          config: candidate.config,
          transport,
        });
        if (result.status === 'unavailable' && result.reason === 'capped') {
          log(`${budgetReached.message} ${String(done)} runs done this time.`);
          return { done, capped: true };
        }
        // Not a result about the model: nothing is saved, so a later run tries the pair again.
        if (result.status === 'unavailable' && result.reason === 'not_configured') {
          throw new BlindTestError(
            `${candidate.id} could not be called (no key, no model or a blocked provider).`,
          );
        }
        const cost = (
          await db.execute<{ cost: string | null }>(
            sql`select cost_micro_usd::text as cost from ai_run where id = ${result.runId}`,
          )
        )[0]?.cost;
        const suggestions =
          result.status === 'ok'
            ? validateRanking(items, result.output, { top, alsoConsider })
            : [];
        output = {
          ref: c.ref,
          candidate: candidate.id,
          status:
            result.status === 'ok'
              ? suggestions.length > 0
                ? 'ok'
                : 'no_valid_suggestions'
              : result.reason,
          suggestions,
          onShortlist,
          latencyMs: Date.now() - started,
          costPaise: cost ? Number(microUsdToPaise(BigInt(cost), rate)) : null,
        };
      }
      await writeJson(path, output);
      done += 1;
    }
  }
  log(`${String(done)} runs done; ${String(cases.length * candidates.length)} in all.`);
  return { done, capped: false };
}

/**
 * A row's check: its read-only cells, the candidate behind its label and the key's seed, so a row
 * that was edited, or read against another key, is refused. Only plain characters count (a
 * spreadsheet saving the file in another encoding changes the rest), and the "k-" keeps the cell
 * text in a spreadsheet.
 */
function rowCheck(
  cells: readonly string[],
  candidate: string,
  seed: number,
  scorer: number,
): string {
  const plain = cells.map((cell) => cell.replace(/\r/g, '').replace(/[^\x20-\x7E\n]/g, ''));
  const hash = sha256([...plain, candidate, String(seed), String(scorer)].join('\u0000'));
  return ['k', hash.slice(0, 12)].join('-');
}

interface Key {
  runId: string;
  seed: number;
  labels: Record<string, Record<string, string>>;
  /** How many scoring sheets were issued. */
  scorers: number;
}

/** Every case's output from every candidate, or why not. */
async function allOutputs(outDir: string, cases: readonly BlindTestCase[], record: RunRecord) {
  const missing = cases.flatMap((c) =>
    record.candidates.map((candidate) => join(outDir, 'outputs', `${c.ref}.${candidate}.json`)),
  );
  let have = 0;
  for (const path of missing) if (await exists(path)) have += 1;
  if (have !== missing.length) {
    throw new BlindTestError(
      `The run is not finished: ${String(have)} of ${String(missing.length)} outputs. Run it again first.`,
    );
  }
}

/** Scoring sheets, one per clinician, with the models hidden; the key stays with the operator. */
export async function makeSheets(
  db: Db,
  options: { casesPath: string; outDir: string; scorers: number; seed?: number },
): Promise<{ sheets: number; rows: number }> {
  const record = (await readJson(join(options.outDir, 'run.json'))) as RunRecord;
  const listings = await knowledgeListings(db, record.kbVersionId);
  const { cases } = await loadCases(options.casesPath, listings, { dryRun: record.dryRun });
  const names = new Map(
    listings.map((l) => [`${l.conditionId}:${l.region}:${String(l.rowNumber)}`, l.name]),
  );
  const nameOf = (id: string) => listings.find((l) => l.conditionId === id)?.name ?? id;
  await allOutputs(options.outDir, cases, record);
  // Once issued, the key never changes: more sheets reuse its seed and labels.
  const keyPath = join(options.outDir, 'key.json');
  const existing = (await exists(keyPath)) ? ((await readJson(keyPath)) as Key) : null;
  if (existing && options.seed !== undefined && options.seed !== existing.seed) {
    throw new BlindTestError('This folder already has a key; its sheets keep its labels.');
  }
  const seed = existing?.seed ?? options.seed ?? randomInt(1, 2 ** 31);
  const labels = assignLabels(
    cases.map((c) => c.ref),
    record.candidates,
    seededRandom(seed),
  );
  await mkdir(join(options.outDir, 'scoring', 'returned'), { recursive: true });
  await writeJson(keyPath, {
    runId: record.runId,
    seed,
    labels,
    scorers: Math.max(existing?.scorers ?? 0, options.scorers),
  });
  const rowsFor_ = async (c: BlindTestCase, scorer: number) => {
    const out: string[][] = [];
    for (const [label, candidate] of Object.entries(labels[c.ref] ?? {})) {
      const output = (await readJson(
        join(options.outDir, 'outputs', `${c.ref}.${candidate}.json`),
      )) as BlindTestOutput;
      const suggestions =
        output.suggestions.length === 0
          ? 'No suggestions (unavailable)'
          : output.suggestions
              .map(
                (s) =>
                  `${String(s.rank)}. ${names.get(`${s.conditionId}:${s.region}:${String(s.rowNumber)}`) ?? s.conditionId}${s.section === 'also_consider' ? ' (also consider)' : ''}: ${s.reason}`,
              )
              .join('\n');
      const shown = [
        c.ref,
        label,
        c.case.region,
        c.case.age === null ? '' : String(c.case.age),
        c.case.sex ?? '',
        c.case.symptoms.join('; '),
        c.case.durationWeeks === null ? '' : durationLabel(c.case.durationWeeks),
        c.confirmed.map(nameOf).join('; '),
        suggestions,
      ];
      const [ref, lab, ...rest] = shown;
      out.push([
        ref ?? '',
        lab ?? '',
        rowCheck(shown, candidate, seed, scorer),
        ...rest,
        '',
        '',
        '',
      ]);
    }
    return out;
  };
  let rows = 0;
  for (let scorer = 1; scorer <= options.scorers; scorer += 1) {
    // Each clinician reads the cases in their own order.
    const random = seededRandom(seed + scorer);
    const order = cases.map((c) => ({ c, k: random() })).toSorted((a, b) => a.k - b.k);
    const body: string[][] = [];
    for (const { c } of order) body.push(...(await rowsFor_(c, scorer)));
    rows = body.length;
    await writeFile(
      join(options.outDir, 'scoring', `${['scorer', String(scorer)].join('-')}.csv`),
      // With a byte order mark, so spreadsheets read the names in UTF-8.
      `\uFEFF${toCsv([...SHEET_COLUMNS], body)}`,
      'utf8',
    );
  }
  return { sheets: options.scorers, rows };
}

/**
 * Reads one returned sheet against the key: every row as issued, each case and label exactly
 * once, every score filled in.
 */
export function readSheet(
  text: string,
  file: string,
  key: Key,
): (BlindTestScore & { scorer: string; candidate: string; sheet: number })[] {
  const [header, ...rows] = fromCsv(text);
  if (header?.join(',') !== SHEET_COLUMNS.join(',')) {
    throw new BlindTestError(`${file}: the columns were changed.`);
  }
  const expected = Object.entries(key.labels).flatMap(([ref, labels]) =>
    Object.keys(labels).map((label) => `${ref} ${label}`),
  );
  const seen = rows.map(([ref = '', label = '']) => `${ref} ${label}`);
  if (
    new Set(seen).size !== seen.length ||
    seen.length !== expected.length ||
    expected.some((row) => !seen.includes(row))
  ) {
    throw new BlindTestError(`${file}: every case and label must be there exactly once.`);
  }
  const checked = (cells: string[], scorer: number) => {
    const [ref = '', label = '', check = '', ...rest] = cells;
    // Undo only the apostrophe the sheet added before a formula character.
    const shown = [ref, label, ...rest.slice(0, 7)].map((cell) =>
      cell.replace(/^'(?=[=+\-@\t\r])/, ''),
    );
    return rowCheck(shown, key.labels[ref]?.[label] ?? '', key.seed, scorer) === check.trim();
  };
  // Which issued sheet this is: its first row says, and every row must agree.
  const scorer = Array.from({ length: key.scorers }, (_, i) => i + 1).find((n) =>
    checked(rows[0] ?? [], n),
  );
  return rows.map((cells) => {
    const [ref = '', label = '', , ...rest] = cells;
    const candidate = key.labels[ref]?.[label] ?? '';
    if (scorer === undefined || !checked(cells, scorer)) {
      throw new BlindTestError(
        `${file}: ${ref} ${label} was changed; only the scores are filled in.`,
      );
    }
    const usefulness = Number(rest[7]);
    const unsafe = (rest[8] ?? '').trim().toLowerCase();
    const parsed = blindTestScoreSchema.safeParse({
      ref,
      label,
      usefulness,
      unsafe: unsafe === 'yes' ? true : unsafe === 'no' ? false : undefined,
    });
    if (!parsed.success) {
      throw new BlindTestError(
        `${file}: ${ref} ${label} needs usefulness 1 to 5 and unsafe yes or no.`,
      );
    }
    return { ...parsed.data, scorer: file, candidate, sheet: scorer };
  });
}

/** The comparison, with the models named again from the key. Writes report.md and report.json. */
export async function compareBlindTest(
  db: Db,
  options: { casesPath: string; outDir: string },
): Promise<string> {
  const record = (await readJson(join(options.outDir, 'run.json'))) as RunRecord;
  const listings = await knowledgeListings(db, record.kbVersionId);
  const { cases } = await loadCases(options.casesPath, listings, { dryRun: record.dryRun });
  await allOutputs(options.outDir, cases, record);
  const outputs: BlindTestOutput[] = [];
  for (const file of await readdir(join(options.outDir, 'outputs'))) {
    outputs.push((await readJson(join(options.outDir, 'outputs', file))) as BlindTestOutput);
  }
  const key = (await readJson(join(options.outDir, 'key.json'))) as Key;
  if (key.runId !== record.runId) throw new BlindTestError('The key belongs to another run.');
  const returned = join(options.outDir, 'scoring', 'returned');
  const scores: (BlindTestScore & { scorer: string; candidate: string })[] = [];
  const sheets: Record<string, string> = {};
  const returnedSheets = new Set<number>();
  for (const file of (await readdir(returned)).filter((f) => f.endsWith('.csv')).sort()) {
    const text = await readFile(join(returned, file), 'utf8');
    sheets[file] = sha256(text);
    const read = readSheet(text, file, key);
    // Each issued sheet comes back once: two files of one scorer would count them twice.
    const sheet = read[0]?.sheet;
    if (sheet !== undefined && read.length > 0 && returnedSheets.has(sheet)) {
      throw new BlindTestError(`${file} is scorer ${String(sheet)}'s sheet again.`);
    }
    if (sheet !== undefined) returnedSheets.add(sheet);
    scores.push(...read.map(({ sheet: _sheet, ...score }) => score));
  }
  const metrics = blindTestMetrics({ cases, outputs, scores, top: record.top });
  const report = blindTestReport(metrics, {
    runId: record.runId,
    kbVersionNumber: record.kbVersionNumber,
    promptVersion: record.promptVersion,
    cases: cases.length,
    top: record.top,
  });
  // A dry run called no model: it is never a blind test, and gives no reference for the gate.
  const reference = record.dryRun
    ? 'Dry run: no model was called, so there is no reference for the AI gate.'
    : `Blind test ${record.startedAt.slice(0, 10)}, run ${record.runId.slice(0, 8)}, report sha256 ${sha256(report).slice(0, 12)}`;
  await writeFile(
    join(options.outDir, 'report.md'),
    record.dryRun
      ? `DRY RUN: no model was called. This is not a blind test.\n\n${report}`
      : `${report}\nReference for the AI gate: ${reference}\n`,
    'utf8',
  );
  await writeJson(join(options.outDir, 'report.json'), {
    ...metrics,
    record,
    sheets,
    reference,
    // Each prompt the candidates ran, by version, so a later prompt change shows.
    prompts: Object.fromEntries(
      record.promptVersion
        .split(', ')
        .filter((v): v is AiPromptVersion => v in PROMPTS)
        .map((v) => [v, sha256(PROMPTS[v])]),
    ),
  });
  return reference;
}
