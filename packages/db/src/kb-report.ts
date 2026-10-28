import {
  KB_REPORT_TASK,
  istMonthBounds,
  kbReportBodySchema,
  kbReportTitle,
  nextKbReportRun,
  type ConfirmedDiagnosisStage,
  type ConfirmedLabel,
  type DispositionCount,
  type KbReportBody,
} from '@clinic-mx/schemas';
import { desc, eq, sql } from 'drizzle-orm';
import { enqueueJob } from './jobs/queue';
import { kbReport, task } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The monthly knowledge base report (AI-08; PRD section 6; TAD: 1st of each month;
 * docs/runbooks/ai-kb-report.md). Counts only, from the preparation sheets (AI-03, AI-04) and the
 * diagnoses confirmed at review or discharge (AI-05), over the month's IST bounds. Read by the
 * system (`system:ai`): only aggregates and knowledge base names leave these queries.
 */

export const KB_REPORT_JOB = 'ai.kb_report';

export interface KbReportData {
  dispositions: DispositionCount[];
  sheetsReady: number;
  sheetsUnavailable: number;
  unmarked: number;
  labels: ConfirmedLabel[];
  /** The versions the counted sheets and labels were on. */
  kbVersions: { id: string; number: number }[];
}

/** The month's counts, as the report reads them. */
export async function kbReportData(db: DbOrTransaction, month: string): Promise<KbReportData> {
  const { start, end } = istMonthBounds(month);
  const from = sql`${start.toISOString()}::timestamptz`;
  const to = sql`${end.toISOString()}::timestamptz`;

  // Each (sheet, condition) once, at its latest Keep or Dismiss (a recheck may show it again).
  const dispositions = await db.execute<{
    version_id: string;
    version_number: number;
    condition_id: string;
    name: string;
    kept: number;
    dismissed: number;
  }>(sql`
    with latest as (
      select distinct on (s.sheet_id, s.condition_id)
        s.sheet_id, s.condition_id, s.disposition, s.disposed_at
      from public.ai_suggestion s
      where s.disposition is not null
      order by s.sheet_id, s.condition_id, s.disposed_at desc, s.id desc
    )
    select v.id as version_id, v.number as version_number, l.condition_id, k.name,
      (count(*) filter (where l.disposition = 'kept'))::int as kept,
      (count(*) filter (where l.disposition = 'dismissed'))::int as dismissed
    from latest l
    join public.ai_preparation_sheet p on p.id = l.sheet_id
    join public.kb_version v on v.id = p.kb_version_id
    join public.kb_condition k on k.kb_version_id = p.kb_version_id
      and k.condition_id = l.condition_id
    where l.disposed_at >= ${from} and l.disposed_at < ${to}
    group by v.id, v.number, l.condition_id, k.name`);

  const [sheets] = await db.execute<{ ready: number; unavailable: number; unmarked: number }>(sql`
    select
      (count(*) filter (where p.status = 'ready'))::int as ready,
      (count(*) filter (where p.status = 'unavailable'))::int as unavailable,
      (select count(distinct (s.sheet_id, s.condition_id))::int
        from public.ai_suggestion s
        join public.ai_preparation_sheet q on q.id = s.sheet_id
        where q.ready_at >= ${from} and q.ready_at < ${to}
          and not exists (
            select 1 from public.ai_suggestion m
            where m.sheet_id = s.sheet_id and m.condition_id = s.condition_id
              and m.disposition is not null
          )) as unmarked
    from public.ai_preparation_sheet p
    where p.ready_at >= ${from} and p.ready_at < ${to}`);

  // Each episode's latest confirmation, counted in the month it was made.
  const labels = await db.execute<{
    version_id: string;
    version_number: number;
    condition_id: string;
    name: string;
    stage: ConfirmedDiagnosisStage;
    from_id: string;
    from_name: string;
    sheet: ConfirmedLabel['sheet'];
    in_top: boolean;
    in_also_consider: boolean;
    on_shortlist: boolean;
    in_recheck_top: boolean;
    top_size: number;
  }>(sql`
    with latest as (
      select distinct on (cd.episode_id) cd.*
      from public.confirmed_diagnosis cd
      order by cd.episode_id, cd.confirmed_at desc, cd.id desc
    )
    select v.id as version_id, v.number as version_number, l.condition_id, k.name, l.stage,
      d.condition_id as from_id, kf.name as from_name,
      case
        when p.id is null or p.status <> 'ready' or p.ai_run_id is null then 'no_ranking'
        when p.kb_version_id <> l.kb_version_id then 'other_version'
        else 'ranked'
      end as sheet,
      exists (
        select 1 from public.ai_suggestion s
        where s.sheet_id = p.id and s.ai_run_id = p.ai_run_id
          and s.condition_id = l.condition_id and s.section = 'top'
      ) as in_top,
      exists (
        select 1 from public.ai_suggestion s
        where s.sheet_id = p.id and s.ai_run_id = p.ai_run_id
          and s.condition_id = l.condition_id and s.section = 'also_consider'
      ) as in_also_consider,
      coalesce(
        p.shortlist -> 'items' @> jsonb_build_array(jsonb_build_object('conditionId', l.condition_id)),
        false
      ) as on_shortlist,
      exists (
        select 1 from public.ai_suggestion s
        where p.recheck_ai_run_id is not null and s.sheet_id = p.id
          and s.ai_run_id = p.recheck_ai_run_id
          and s.condition_id = l.condition_id and s.section = 'top'
      ) as in_recheck_top,
      (
        select count(*)::int from public.ai_suggestion s
        where s.sheet_id = p.id and s.ai_run_id = p.ai_run_id and s.section = 'top'
      ) as top_size
    from latest l
    join public.diagnosis d on d.id = l.source_diagnosis_id
    join public.kb_version v on v.id = l.kb_version_id
    join public.kb_condition k on k.kb_version_id = l.kb_version_id
      and k.condition_id = l.condition_id
    join public.kb_condition kf on kf.kb_version_id = d.kb_version_id
      and kf.condition_id = d.condition_id
    left join public.ai_preparation_sheet p on p.episode_id = l.episode_id
    where l.confirmed_at >= ${from} and l.confirmed_at < ${to}`);

  const versions = new Map<string, number>();
  for (const row of [...dispositions, ...labels]) versions.set(row.version_id, row.version_number);
  return {
    dispositions: dispositions.map((row) => ({
      kbVersionNumber: row.version_number,
      conditionId: row.condition_id,
      name: row.name,
      kept: row.kept,
      dismissed: row.dismissed,
    })),
    sheetsReady: sheets?.ready ?? 0,
    sheetsUnavailable: sheets?.unavailable ?? 0,
    unmarked: sheets?.unmarked ?? 0,
    labels: labels.map((row) => ({
      conditionId: row.condition_id,
      name: row.name,
      stage: row.stage,
      fromId: row.from_id,
      fromName: row.from_name,
      sheet: row.sheet,
      inTop: row.in_top,
      inAlsoConsider: row.in_also_consider,
      onShortlist: row.on_shortlist,
      inRecheckTop: row.in_recheck_top,
      topSize: row.top_size,
    })),
    kbVersions: [...versions.entries()]
      .map(([id, number]) => ({ id, number }))
      .toSorted((a, b) => a.number - b.number),
  };
}

/**
 * Keeps the month's report and sends it to the Super Admin as a task, both once: a month already
 * reported stays as it was built and gets no second task. The report's id, or null when it existed.
 */
export async function storeKbReport(
  tx: DbOrTransaction,
  report: { month: string; kbVersionId: string | null; body: KbReportBody },
): Promise<string | null> {
  const body = kbReportBodySchema.parse(report.body);
  const [row] = await tx
    .insert(kbReport)
    .values({ month: report.month, kbVersionId: report.kbVersionId, body })
    .onConflictDoNothing({ target: kbReport.month })
    .returning({ id: kbReport.id });
  if (!row) return null;
  await tx.insert(task).values({
    kind: KB_REPORT_TASK,
    title: kbReportTitle(report.month),
    details: { reportId: row.id, month: report.month },
    priority: 'normal',
    assigneeRole: 'super_admin',
  });
  return row.id;
}

/** Queues the next month's report (its own key per month, so queuing twice adds nothing). */
export async function queueNextKbReport(tx: DbOrTransaction, month: string): Promise<string> {
  const next = nextKbReportRun(month);
  await enqueueJob(tx, {
    kind: KB_REPORT_JOB,
    payload: { month: next.month },
    runAt: next.runAt,
    idempotencyKey: [KB_REPORT_JOB, next.month].join(':'),
  });
  return next.month;
}

export interface KbReportRecord {
  month: string;
  generatedAt: Date;
  body: KbReportBody;
}

/** Every report the reader may read (the Super Admin), newest month first. */
export async function kbReports(db: DbOrTransaction): Promise<KbReportRecord[]> {
  const rows = await db
    .select({ month: kbReport.month, generatedAt: kbReport.generatedAt, body: kbReport.body })
    .from(kbReport)
    .orderBy(desc(kbReport.month));
  return rows.map((row) => ({ ...row, body: kbReportBodySchema.parse(row.body) }));
}

/** One month's report, as the reader may read it; undefined when none, or not theirs to read. */
export async function kbReportOf(
  db: DbOrTransaction,
  month: string,
): Promise<KbReportRecord | undefined> {
  const [row] = await db
    .select({ month: kbReport.month, generatedAt: kbReport.generatedAt, body: kbReport.body })
    .from(kbReport)
    .where(eq(kbReport.month, month));
  return row && { ...row, body: kbReportBodySchema.parse(row.body) };
}
