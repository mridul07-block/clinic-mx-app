import 'server-only';
import {
  kbReportData,
  kbReportOf,
  kbReports,
  latestKnowledgeVersion,
  queueNextKbReport,
  storeKbReport,
  type Db,
  type KbReportData,
  type KbReportRecord,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  istMonthBounds,
  comparedTopCount,
  labelSections,
  oftenDismissed,
  reportMonthSchema,
  type KbReportBody,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * The monthly knowledge base report (AI-08; PRD section 6: "Monthly report to the Super Admin:
 * suggestions often dismissed, diagnoses the AI missed, diagnoses changed at review"; TAD: 1st of
 * each month). The job for a month queues the next month's first, in its own transaction, so a
 * failed month never breaks the chain; then, once the month has ended, it builds the report from
 * counts (no model call) and sends it to the Super Admin as a task, once. Recommended defaults
 * chosen under the user's standing approval, 29 October 2026 (DECISION AI-08).
 */

const forMonth = z.object({ month: reportMonthSchema });

const queueNext = systemService({
  component: 'ai',
  input: forMonth,
  run: (tx, { month }) => queueNextKbReport(tx, month),
});

const build = systemService({
  component: 'ai',
  input: forMonth,
  run: async (tx, { month }) => {
    const body = kbReportBody(month, await kbReportData(tx, month), {
      minMarked: await getSetting('ai.kb_report_dismissed_min_marked'),
      sharePercent: await getSetting('ai.kb_report_dismissed_share_percent'),
    });
    const version = await latestKnowledgeVersion(tx);
    return storeKbReport(tx, { month, kbVersionId: version?.id ?? null, body });
  },
});

/**
 * The report's body from the month's counts and the settings it is built with; the top size is the
 * compared sheets' own, as each was made.
 */
export function kbReportBody(
  month: string,
  data: KbReportData,
  thresholds: Omit<KbReportBody['thresholds'], 'topCount'>,
): KbReportBody {
  const sections = labelSections(data.labels);
  return {
    month,
    kbVersions: data.kbVersions,
    thresholds: { ...thresholds, topCount: comparedTopCount(data.labels) },
    totals: {
      sheetsReady: data.sheetsReady,
      sheetsUnavailable: data.sheetsUnavailable,
      marked: data.dispositions.reduce((sum, row) => sum + row.kept + row.dismissed, 0),
      unmarked: data.unmarked,
      ...sections.totals,
    },
    oftenDismissed: oftenDismissed(data.dispositions, thresholds),
    missed: sections.missed,
    changed: sections.changed,
  };
}

/**
 * The month's run: the next month queued, then the report once the month has ended. 'built', or
 * 'early' before the month ends, or 'already' when it was built before (a run that ran twice).
 */
export async function runKbReport(
  db: Db,
  input: { month: string },
  now = new Date(),
): Promise<'built' | 'early' | 'already'> {
  await queueNext(db, input);
  if (now < istMonthBounds(input.month).end) return 'early';
  return (await build(db, input)) ? 'built' : 'already';
}

/** Who reads the reports: the Super Admin, who approves knowledge base versions (never support). */
export function readsKbReports(actor: StaffMember): boolean {
  return can(actor, 'knowledge_base.edit') && !actor.support;
}

/** The reports, newest first, for the Super Admin; null for anyone else. */
export async function loadKbReports(actor: StaffMember): Promise<KbReportRecord[] | null> {
  if (!readsKbReports(actor)) return null;
  return asStaff(actor, (tx) => kbReports(tx));
}

/** One month's report for the Super Admin; undefined when none or not theirs to read. */
export async function loadKbReport(
  actor: StaffMember,
  month: string,
): Promise<KbReportRecord | undefined> {
  if (!readsKbReports(actor) || !reportMonthSchema.safeParse(month).success) return undefined;
  return asStaff(actor, (tx) => kbReportOf(tx, month));
}
