import { createDb, kbReport, storeKbReport, systemActor, task, withActor } from '@clinic-mx/db';
import type { KbReportBody } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';

// Monthly knowledge base reports for the AI-08 tests: one stored as the monthly job stores it,
// with its task, for a generated far future month; removed after, audited as system:tests (reports
// are kept as built, so the removal turns that one guard off for its own transaction).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** A month far ahead that no real report has, "2071-04". */
export function farMonth(): string {
  const index = Math.floor(Math.random() * 12 * 40);
  return [String(2050 + Math.floor(index / 12)), String((index % 12) + 1).padStart(2, '0')].join(
    '-',
  );
}

/** The month's report with generated counts and knowledge base names, and its task. */
export async function seedKbReport(month: string, kbVersion: { id: string; number: number }) {
  const body: KbReportBody = {
    month,
    kbVersions: [kbVersion],
    thresholds: { minMarked: 5, sharePercent: 50, topCount: 3 },
    totals: {
      sheetsReady: 12,
      sheetsUnavailable: 1,
      marked: 30,
      unmarked: 6,
      labels: 9,
      labelsCompared: 8,
      inTop: 6,
      labelsWithoutRanking: 1,
      labelsOtherVersion: 0,
      changed: 2,
    },
    oftenDismissed: [
      {
        kbVersionNumber: kbVersion.number,
        conditionId: 'KNE-005',
        name: 'Fake Often Dismissed Condition',
        kept: 2,
        dismissed: 4,
        sharePercent: 66,
      },
    ],
    missed: [
      {
        conditionId: 'KNE-004',
        name: 'Fake Missed Condition',
        count: 2,
        alsoConsider: 1,
        shortlistedNotSuggested: 1,
        notShortlisted: 0,
        foundAtRecheck: 1,
      },
    ],
    changed: [
      {
        fromId: 'KNE-001',
        fromName: 'Fake First Impression',
        toId: 'KNE-004',
        toName: 'Fake Missed Condition',
        stage: 'review',
        count: 2,
      },
    ],
  };
  await withActor(db(), systemActor('ai'), (tx) =>
    storeKbReport(tx, { month, kbVersionId: kbVersion.id, body }),
  );
}

/** Removes the month's report and its task. */
export async function removeKbReport(month: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx
      .delete(task)
      .where(and(eq(task.kind, 'ai.kb_report'), sql`${task.details} ->> 'month' = ${month}`));
    await tx.execute(sql`alter table public.kb_report disable trigger kb_report_append_only`);
    await tx.delete(kbReport).where(eq(kbReport.month, month));
    await tx.execute(sql`alter table public.kb_report enable trigger kb_report_append_only`);
  });
}
