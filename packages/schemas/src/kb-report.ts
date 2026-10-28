import { z } from 'zod';
import { confirmedDiagnosisStages, type ConfirmedDiagnosisStage } from './confirmed-diagnosis';
import { addMonths, monthLabel } from './finance';
import { istInstant, startOfIstDay } from './ist';
import { parseTime } from './rosters';

/**
 * The monthly knowledge base report (AI-08; PRD section 6: "Monthly report to the Super Admin:
 * suggestions often dismissed, diagnoses the AI missed, diagnoses changed at review. Knowledge base
 * edits go live only as a new version he approves."; TAD: "Monthly knowledge base report | 1st of
 * each month"). Deterministic counts, no model call; built once per month, kept as built, and sent
 * to the Super Admin as a task. Recommended defaults chosen under the user's standing approval,
 * 29 October 2026 (DECISION AI-08 in docs/PROGRESS.md; docs/runbooks/ai-kb-report.md).
 */

export const KB_REPORT_TASK = 'ai.kb_report';

/**
 * When the report for the month just ended is built: the TAD gives the 1st of each month and no
 * time. DECISION AI-08: 01:00 IST, a recommended default.
 */
export const KB_REPORT_TIME = '01:00';

/** A calendar month, "2026-10". */
export const reportMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'That month was not found.' });

/** The month's IST bounds, half open: from its 1st at midnight IST to the next month's. */
export function istMonthBounds(month: string): { start: Date; end: Date } {
  return {
    start: startOfIstDay(`${month}-01`),
    end: startOfIstDay(`${addMonths(month, 1)}-01`),
  };
}

/**
 * The run after the report for `month`: the next month's report, on the 1st of the month after it.
 * Each month is its own report, so a chain behind after downtime catches up one month at a time.
 */
export function nextKbReportRun(month: string): { month: string; runAt: Date } {
  const minutes = parseTime(KB_REPORT_TIME);
  if (minutes === undefined) throw new Error(`Not a time of day: ${KB_REPORT_TIME}`);
  return { month: addMonths(month, 1), runAt: istInstant(`${addMonths(month, 2)}-01`, minutes) };
}

/** "Knowledge base report for Oct 2026". */
export function kbReportTitle(month: string): string {
  return `Knowledge base report for ${monthLabel(month, true)}`;
}

const count = z.int().nonnegative();
const conditionId = z.string().min(1).max(40);
const name = z.string().max(200);

/** What a report holds: counts and knowledge base names only, never a patient, episode or staff ID. */
export const kbReportBodySchema = z.strictObject({
  month: reportMonthSchema,
  /** The knowledge base versions the counted sheets and labels were on. */
  kbVersions: z.array(z.strictObject({ id: z.guid(), number: z.int().positive() })),
  /** The settings it was built with, so an old report can still be read after they change. */
  thresholds: z.strictObject({
    minMarked: z.int().positive(),
    sharePercent: z.int().min(1).max(100),
    /**
     * How many top suggestions the compared sheets had (`ai.sheet_top_count` when each was made);
     * null when they differ or none was compared.
     */
    topCount: z.int().positive().nullable(),
  }),
  totals: z.strictObject({
    /** Preparation sheets made in the month: ranked, and unavailable. */
    sheetsReady: count,
    sheetsUnavailable: count,
    /** Suggestions kept or dismissed in the month, and those on its sheets never marked. */
    marked: count,
    unmarked: count,
    /** Diagnoses confirmed in the month (each episode's latest). */
    labels: count,
    /** Of them, with a ranked sheet on the same knowledge base version: compared. */
    labelsCompared: count,
    /** In the top suggestions of the first ranking. */
    inTop: count,
    /** Not compared: no ranked sheet (none, or unavailable), or another knowledge base version. */
    labelsWithoutRanking: count,
    labelsOtherVersion: count,
    /** Changed from the consultation's diagnosis. */
    changed: count,
  }),
  oftenDismissed: z.array(
    z.strictObject({
      kbVersionNumber: z.int().positive(),
      conditionId,
      name,
      kept: count,
      dismissed: count,
      sharePercent: z.int().min(0).max(100),
    }),
  ),
  missed: z.array(
    z.strictObject({
      conditionId,
      name,
      count,
      /** Suggested, but under Also consider. */
      alsoConsider: count,
      /** On the shortlist, but not suggested. */
      shortlistedNotSuggested: count,
      /** Not on the shortlist at all. */
      notShortlisted: count,
      /** In the top suggestions of a later Recheck with findings (AI-04). */
      foundAtRecheck: count,
    }),
  ),
  changed: z.array(
    z.strictObject({
      fromId: conditionId,
      fromName: name,
      toId: conditionId,
      toName: name,
      stage: z.enum(confirmedDiagnosisStages),
      count,
    }),
  ),
});
export type KbReportBody = z.infer<typeof kbReportBodySchema>;

/** Kept and dismissed suggestions of one condition on one version, in the month. */
export interface DispositionCount {
  kbVersionNumber: number;
  conditionId: string;
  name: string;
  kept: number;
  dismissed: number;
}

/** The share dismissed, a whole percent rounded down. */
export function dismissedShare(kept: number, dismissed: number): number {
  const marked = kept + dismissed;
  return marked === 0 ? 0 : Math.floor((dismissed * 100) / marked);
}

/**
 * Suggestions often dismissed (DECISION AI-08): marked at least `minMarked` times in the month and
 * dismissed at least `sharePercent` of those times; most dismissed first.
 */
export function oftenDismissed(
  rows: readonly DispositionCount[],
  thresholds: { minMarked: number; sharePercent: number },
): KbReportBody['oftenDismissed'] {
  return rows
    .map((row) => ({ ...row, sharePercent: dismissedShare(row.kept, row.dismissed) }))
    .filter(
      (row) =>
        row.kept + row.dismissed >= thresholds.minMarked &&
        row.sharePercent >= thresholds.sharePercent,
    )
    .toSorted(
      (a, b) =>
        b.sharePercent - a.sharePercent ||
        b.dismissed - a.dismissed ||
        a.kbVersionNumber - b.kbVersionNumber ||
        a.conditionId.localeCompare(b.conditionId),
    );
}

/** One diagnosis confirmed in the month (an episode's latest), against its preparation sheet. */
export interface ConfirmedLabel {
  conditionId: string;
  name: string;
  stage: ConfirmedDiagnosisStage;
  /** The consultation's diagnosis it confirms or changes. */
  fromId: string;
  fromName: string;
  /** The sheet: none or not ranked, ranked on another version, or ranked on the label's version. */
  sheet: 'no_ranking' | 'other_version' | 'ranked';
  inTop: boolean;
  inAlsoConsider: boolean;
  onShortlist: boolean;
  /** In the top of the latest Recheck with findings. */
  inRecheckTop: boolean;
  /** How many top suggestions the sheet's first ranking had; 0 without one. */
  topSize: number;
}

/**
 * The missed and changed sections and their totals (DECISION AI-08). A label is compared only
 * against a ranked sheet on its own knowledge base version (condition IDs are not promised across
 * versions); it is missed when it is not among the first ranking's top suggestions, graded by how
 * near it came. Changed means confirmed as another condition than the consultation's.
 */
export function labelSections(labels: readonly ConfirmedLabel[]): {
  totals: Pick<
    KbReportBody['totals'],
    | 'labels'
    | 'labelsCompared'
    | 'inTop'
    | 'labelsWithoutRanking'
    | 'labelsOtherVersion'
    | 'changed'
  >;
  missed: KbReportBody['missed'];
  changed: KbReportBody['changed'];
} {
  const compared = labels.filter((l) => l.sheet === 'ranked');
  const missedBy = new Map<string, KbReportBody['missed'][number]>();
  for (const label of compared.filter((l) => !l.inTop)) {
    const row = missedBy.get(label.conditionId) ?? {
      conditionId: label.conditionId,
      name: label.name,
      count: 0,
      alsoConsider: 0,
      shortlistedNotSuggested: 0,
      notShortlisted: 0,
      foundAtRecheck: 0,
    };
    row.count += 1;
    if (label.inAlsoConsider) row.alsoConsider += 1;
    else if (label.onShortlist) row.shortlistedNotSuggested += 1;
    else row.notShortlisted += 1;
    if (label.inRecheckTop) row.foundAtRecheck += 1;
    missedBy.set(label.conditionId, row);
  }
  const changedBy = new Map<string, KbReportBody['changed'][number]>();
  const changes = labels.filter((l) => l.conditionId !== l.fromId);
  for (const label of changes) {
    const key = [label.fromId, label.conditionId, label.stage].join('|');
    const row = changedBy.get(key) ?? {
      fromId: label.fromId,
      fromName: label.fromName,
      toId: label.conditionId,
      toName: label.name,
      stage: label.stage,
      count: 0,
    };
    row.count += 1;
    changedBy.set(key, row);
  }
  return {
    totals: {
      labels: labels.length,
      labelsCompared: compared.length,
      inTop: compared.filter((l) => l.inTop).length,
      labelsWithoutRanking: labels.filter((l) => l.sheet === 'no_ranking').length,
      labelsOtherVersion: labels.filter((l) => l.sheet === 'other_version').length,
      changed: changes.length,
    },
    missed: [...missedBy.values()].toSorted(
      (a, b) => b.count - a.count || a.conditionId.localeCompare(b.conditionId),
    ),
    changed: [...changedBy.values()].toSorted(
      (a, b) =>
        b.count - a.count ||
        a.fromId.localeCompare(b.fromId) ||
        a.toId.localeCompare(b.toId) ||
        a.stage.localeCompare(b.stage),
    ),
  };
}

/** The compared sheets' one top size; null when they differ, or none was compared. */
export function comparedTopCount(labels: readonly ConfirmedLabel[]): number | null {
  const sizes = new Set(labels.filter((l) => l.sheet === 'ranked').map((l) => l.topSize));
  const [only] = sizes;
  return sizes.size === 1 && only !== undefined && only > 0 ? only : null;
}

/** "the top 3", or "the top suggestions" when the sheets differ. */
export function topWords(topCount: number | null): string {
  return topCount === null ? 'the top suggestions' : `the top ${String(topCount)}`;
}

/** The share of compared labels in the top suggestions, a whole percent; null when none compared. */
export function inTopPercent(totals: Pick<KbReportBody['totals'], 'labelsCompared' | 'inTop'>) {
  return totals.labelsCompared === 0
    ? null
    : Math.floor((totals.inTop * 100) / totals.labelsCompared);
}
