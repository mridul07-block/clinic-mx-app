import { z } from 'zod';
import { aiCaseSchema, aiTaskConfigSchema, type AiRunStatus } from './ai-gateway';
import type { ValidatedSuggestion } from './ai-sheet';
import type { CandidateCase } from './candidates';
import { conditionIdPattern } from './knowledge';

/**
 * The blind test (AI-06; PRD section 6: "a mid tier model chosen by a blind test on 30 to 50
 * anonymised Movementology cases, scored by clinicians"; TAD section 7: it "reruns whenever the
 * model, prompt or knowledge base changes"). An operator tool runs the client's anonymised cases
 * through each candidate model exactly as the preparation sheet does (shortlist, rank, validate),
 * gives clinicians scoring sheets with the models hidden behind shuffled labels, and compares the
 * results. No pass mark is invented: whether the test passed is the clinicians' call, recorded by
 * the Super Admin on the AI gate (AI-09). Recommended defaults chosen under the user's standing
 * approval, 28 October 2026 (DECISION AI-06 in docs/PROGRESS.md; docs/runbooks/ai-blind-test.md).
 * Cases and results live outside the repository; tests use generated cases only (rule 12).
 */

/**
 * One anonymised case as the client supplies it: the fields the model may be sent, the onset and
 * pain zones the shortlist reads, and the diagnosis confirmed at review or discharge.
 */
export const blindTestCaseSchema = z.strictObject({
  /** "case-001": never a patient's number, and never sent. */
  ref: z.string().regex(/^case-\d{3}$/),
  case: aiCaseSchema,
  onset: z.enum(['gradual', 'sudden']).nullable(),
  painZones: z.array(z.string().max(40)).max(20).default([]),
  /** The knowledge base condition IDs confirmed (any of them counts as right). */
  confirmed: z.array(z.string().regex(conditionIdPattern)).min(1).max(3),
});
export type BlindTestCase = z.infer<typeof blindTestCaseSchema>;

export const blindTestCaseFileSchema = z
  .strictObject({ cases: z.array(blindTestCaseSchema).min(1) })
  .refine((file) => new Set(file.cases.map((c) => c.ref)).size === file.cases.length, {
    error: 'Each case needs its own ref.',
  });

/** A candidate as the operator names it: a label and the gateway settings to run it with. */
export const blindTestCandidateSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  config: aiTaskConfigSchema.extend({
    model: z.string().regex(/^[a-z0-9-]+\/[a-z0-9._:-]+$/),
    providers: z.array(z.string().min(1)).min(1).max(3),
  }),
});
export type BlindTestCandidate = z.infer<typeof blindTestCandidateSchema>;

export const blindTestCandidateFileSchema = z
  .strictObject({ candidates: z.array(blindTestCandidateSchema).min(2).max(5) })
  .refine((file) => new Set(file.candidates.map((c) => c.id)).size === file.candidates.length, {
    error: 'Each candidate needs its own id.',
  });

/** The case as the shortlist reads it (AI-02). */
export function blindTestCandidateCase(c: BlindTestCase): CandidateCase {
  return {
    region: c.case.region,
    age: c.case.age,
    sex: c.case.sex,
    onset: c.onset,
    durationWeeks: c.case.durationWeeks,
    activities: [],
    painZones: c.painZones,
  };
}

/** What one candidate made of one case. */
export interface BlindTestOutput {
  ref: string;
  candidate: string;
  status: AiRunStatus | 'no_valid_suggestions';
  suggestions: ValidatedSuggestion[];
  /** Whether the confirmed diagnosis reached the shortlist at all. */
  onShortlist: boolean;
  latencyMs: number;
  /** The provider's charge in paise; null when not reported. */
  costPaise: number | null;
}

const LABELS = 'ABCDE';

/**
 * Hides the models: for each case, the candidates in a shuffled order behind the labels A to E.
 * `random` returns values in [0, 1) (a seeded one gives the same labels again).
 */
export function assignLabels(
  refs: readonly string[],
  candidates: readonly string[],
  random: () => number,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    refs.map((ref) => {
      const order = [...candidates];
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j] as string, order[i] as string];
      }
      return [ref, Object.fromEntries(order.map((candidate, i) => [LABELS[i] ?? '?', candidate]))];
    }),
  );
}

/** A seeded random in [0, 1) (mulberry32), so labels can be rebuilt from the key's seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One clinician's score for one label on one case. */
export const blindTestScoreSchema = z.strictObject({
  ref: z.string().regex(/^case-\d{3}$/),
  label: z.string().regex(/^[A-E]$/),
  usefulness: z.int().min(1).max(5),
  unsafe: z.boolean(),
});
export type BlindTestScore = z.infer<typeof blindTestScoreSchema>;

/** The scoring sheet's columns: what the scorer reads, then what they fill in. */
export const SHEET_COLUMNS = [
  'case',
  'label',
  'check',
  'region',
  'age',
  'sex',
  'symptoms',
  'duration_weeks',
  'confirmed',
  'suggestions',
  'usefulness_1_to_5',
  'unsafe_yes_no',
  'note',
] as const;

/** Reads CSV as `toCsv` (finance.ts) writes it, or as a spreadsheet saves it. */
export function fromCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body.charAt(i);
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value !== ''));
}

export interface MetricsInput {
  cases: readonly BlindTestCase[];
  outputs: readonly BlindTestOutput[];
  scores: readonly (BlindTestScore & { scorer: string; candidate: string })[];
  top: number;
}

export interface CandidateMetrics {
  candidate: string;
  runs: number;
  statuses: Record<string, number>;
  unavailableRate: number;
  top1: number;
  topN: number;
  topAll: number;
  misses: string[];
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  costPaise: number;
  costReported: number;
  meanUsefulness: number | null;
  unsafe: string[];
}

const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
};
const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

/** Side by side, per candidate: what code can count. The clinicians judge the rest. */
export function blindTestMetrics({ cases, outputs, scores, top }: MetricsInput): {
  candidates: CandidateMetrics[];
  shortlistCeiling: number;
} {
  const confirmed = new Map(cases.map((c) => [c.ref, new Set(c.confirmed)]));
  const ids = [...new Set(outputs.map((o) => o.candidate))].sort();
  const candidates = ids.map((candidate): CandidateMetrics => {
    const mine = outputs.filter((o) => o.candidate === candidate);
    const statuses: Record<string, number> = {};
    for (const o of mine) statuses[o.status] = (statuses[o.status] ?? 0) + 1;
    const rankOf = (o: BlindTestOutput) =>
      o.suggestions.find((s) => confirmed.get(o.ref)?.has(s.conditionId))?.rank ?? null;
    const ranks = mine.map(rankOf);
    const hits = (k: number) =>
      share(ranks.filter((r) => r !== null && r <= k).length, mine.length);
    const costs = mine.flatMap((o) => (o.costPaise === null ? [] : [o.costPaise]));
    const myScores = scores.filter((s) => s.candidate === candidate);
    return {
      candidate,
      runs: mine.length,
      statuses,
      unavailableRate: share(mine.filter((o) => o.status !== 'ok').length, mine.length),
      top1: hits(1),
      topN: hits(top),
      topAll: hits(Number.POSITIVE_INFINITY),
      misses: mine.filter((o, i) => ranks[i] === null).map((o) => o.ref),
      latencyP50Ms: percentile(
        mine.map((o) => o.latencyMs),
        50,
      ),
      latencyP95Ms: percentile(
        mine.map((o) => o.latencyMs),
        95,
      ),
      costPaise: costs.reduce((a, b) => a + b, 0),
      costReported: share(costs.length, mine.length),
      meanUsefulness:
        myScores.length === 0
          ? null
          : myScores.reduce((a, s) => a + s.usefulness, 0) / myScores.length,
      unsafe: [...new Set(myScores.filter((s) => s.unsafe).map((s) => s.ref))].sort(),
    };
  });
  const byCase = new Map(outputs.map((o) => [o.ref, o.onShortlist]));
  return {
    candidates,
    shortlistCeiling: share([...byCase.values()].filter(Boolean).length, byCase.size),
  };
}

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

/** The comparison report: numbers side by side, and no pass or fail line. */
export function blindTestReport(
  metrics: ReturnType<typeof blindTestMetrics>,
  meta: {
    runId: string;
    kbVersionNumber: number;
    promptVersion: string;
    cases: number;
    top: number;
  },
): string {
  const lines = [
    '# Blind test report',
    '',
    `Run ${meta.runId}: ${String(meta.cases)} cases, knowledge base version ${String(meta.kbVersionNumber)}, prompt ${meta.promptVersion}.`,
    `The confirmed diagnosis reached the shortlist in ${pct(metrics.shortlistCeiling)} of cases.`,
    '',
    `| Candidate | Top 1 | Top ${String(meta.top)} | On the sheet | Unavailable | Latency p50 / p95 | Cost | Usefulness | Unsafe |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...metrics.candidates.map(
      (m) =>
        `| ${m.candidate} | ${pct(m.top1)} | ${pct(m.topN)} | ${pct(m.topAll)} | ${pct(m.unavailableRate)} | ${String(m.latencyP50Ms ?? '-')} / ${String(m.latencyP95Ms ?? '-')} ms | ₹${(m.costPaise / 100).toFixed(2)} (${pct(m.costReported)} priced) | ${m.meanUsefulness === null ? '-' : m.meanUsefulness.toFixed(2)} | ${m.unsafe.length === 0 ? 'none' : m.unsafe.join(', ')} |`,
    ),
    '',
    'Whether the blind test passed is the clinicians’ decision (docs/runbooks/ai-gate.md).',
    '',
  ];
  return lines.join('\n');
}
