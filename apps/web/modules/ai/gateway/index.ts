import 'server-only';
import type { Db } from '@clinic-mx/db';
import type { AiCase, AiRankRow, AiTaskConfig } from '@clinic-mx/schemas';
import type { AiSheetPass } from '../gate';
import { runTask, type AiResult, type RunOptions } from './run';

/**
 * The AI gateway's tasks (AI-01; TAD section 7: "One function per task"). Clinical tasks take the
 * AI gate's pass (AI-09), so they cannot run while the sheet is off, and run on the knowledge base
 * version the gate was switched on for. The shortlist goes out numbered; the answer comes back as
 * condition IDs. Whether the ranking is complete and right is AI-03's check.
 */
export type { AiResult } from './run';

export interface ShortlistRow extends Omit<AiRankRow, 'n'> {
  conditionId: string;
}

export interface RankedCondition {
  /** The row's number as sent: its place on the shortlist, from 1. */
  n: number;
  conditionId: string;
  reason: string;
}

interface ClinicalCall {
  case: AiCase;
  rows: readonly ShortlistRow[];
  episodeId: string;
  /** The patient's own name words: never sent. */
  forbidden?: readonly string[];
  transport?: RunOptions['transport'];
}

function numbered(rows: readonly ShortlistRow[]): AiRankRow[] {
  return rows.map(({ conditionId: _id, ...row }, index) => ({ n: index + 1, ...row }));
}

function byCondition(
  rows: readonly ShortlistRow[],
  result: AiResult<{ ranked: { n: number; reason: string }[] }>,
): AiResult<RankedCondition[]> {
  if (result.status !== 'ok') return result;
  return {
    status: 'ok',
    runId: result.runId,
    output: result.output.ranked.flatMap(({ n, reason }) => {
      const row = rows[n - 1];
      return row ? [{ n, conditionId: row.conditionId, reason }] : [];
    }),
  };
}

/** Ranks the preparation sheet's shortlist for the case (AI-03 shows it). */
export async function rankDiagnoses(
  db: Db,
  pass: AiSheetPass,
  call: ClinicalCall,
): Promise<AiResult<RankedCondition[]>> {
  const result = await runTask(
    db,
    'rank_diagnoses',
    { case: call.case, rows: numbered(call.rows) },
    {
      episodeId: call.episodeId,
      kbVersionId: pass.kbVersionId,
      forbidden: call.forbidden,
      transport: call.transport,
    },
  );
  return byCondition(call.rows, result);
}

/**
 * Ranks an anonymised case's shortlist with one blind test candidate (AI-06): its model and
 * providers for this call only, still with zero data retention, the identifier guard and pinning;
 * never an episode and never a gate pass (the sheet itself always reads the task's settings).
 */
export async function rankForBlindTest(
  db: Db,
  call: {
    runId: string;
    kbVersionId: string;
    case: AiCase;
    rows: readonly ShortlistRow[];
    config: AiTaskConfig & { model: string };
    transport?: RunOptions['transport'];
  },
): Promise<AiResult<RankedCondition[]>> {
  const result = await runTask(
    db,
    'rank_diagnoses',
    { case: call.case, rows: numbered(call.rows) },
    {
      episodeId: null,
      kbVersionId: call.kbVersionId,
      blindTest: { runId: call.runId, config: call.config },
      transport: call.transport,
    },
  );
  return byCondition(call.rows, result);
}

/** Ranks the shortlist again with the examination findings, only when tapped (AI-04). */
export async function recheckWithFindings(
  db: Db,
  pass: AiSheetPass,
  call: ClinicalCall & { findings: readonly string[] },
): Promise<AiResult<RankedCondition[]>> {
  const result = await runTask(
    db,
    'recheck_with_findings',
    { case: call.case, rows: numbered(call.rows), findings: [...call.findings] },
    {
      episodeId: call.episodeId,
      kbVersionId: pass.kbVersionId,
      forbidden: call.forbidden,
      transport: call.transport,
    },
  );
  return byCondition(call.rows, result);
}
