import 'server-only';
import {
  frozenBaselineOfEpisode,
  knowledgeObjective,
  reassessmentOfSession,
  sessionReadings,
  type DbOrTransaction,
  type SessionNoteEntry,
} from '@clinic-mx/db';
import {
  baselineReadingText,
  entryOfReadings,
  reassessmentChangeText,
  type KnowledgeMeasure,
  type MeasureEntry,
} from '@clinic-mx/schemas';
import { getSetting } from '../settings/settings';

/**
 * The session 4 reassessment (OUT-05, PRD J5.10; decision 7 default; docs/runbooks/sessions.md
 * "Session 4 reassessment"): session `clinical.reassessment_session` measures exactly what the
 * episode's frozen baseline holds (OUT-01). While the note is a draft each measure shows its
 * baseline; once signed, baseline against this session with the change, for the session screen
 * and the consultant's review.
 */

export interface ReassessedItem {
  measure: KnowledgeMeasure;
  /** The baseline's reading as an entry, for the live change while writing. */
  baselineEntry: MeasureEntry;
  /** The baseline reading as the consultation shows it; null when not tested then. */
  baseline: string | null;
  baselineNotTested: string | null;
}

export interface ReassessedRow extends ReassessedItem {
  now: string | null;
  nowNotTested: string | null;
  change: string;
}

export interface ReassessmentView {
  sessionNumber: number;
  /** Null until the session is signed. */
  reassessmentId: string | null;
  items: ReassessedItem[];
  /** Once signed: baseline against this session. */
  rows: ReassessedRow[] | null;
  decision: { text: string; by: string; at: Date } | null;
  consultantName: string | null;
}

/** The baseline's measures that session `number` reassesses, in the workbook's order. */
export async function reassessedItems(
  tx: DbOrTransaction,
  episodeId: string,
  kbVersionId: string,
): Promise<ReassessedItem[]> {
  const frozen = await frozenBaselineOfEpisode(tx, episodeId);
  if (frozen.length === 0) return [];
  const catalog = (await knowledgeObjective(tx, kbVersionId)).measures;
  return catalog.flatMap((measure): ReassessedItem[] => {
    const row = frozen.find((r) => r.key === measure.key);
    if (!row) return [];
    const baselineEntry = entryOfReadings(row.readings);
    return [
      {
        measure,
        baselineEntry,
        baseline: row.readings.length ? baselineReadingText(measure, baselineEntry) : null,
        baselineNotTested: row.notTestedReason,
      },
    ];
  });
}

/** Baseline against the session's own readings, with the change. */
export async function reassessedRows(
  tx: DbOrTransaction,
  items: ReassessedItem[],
  sessionId: string,
  notTested: Record<string, string>,
): Promise<ReassessedRow[]> {
  const readings = await sessionReadings(
    tx,
    sessionId,
    items.map((item) => item.measure.key),
  );
  return retestRows(items, readings, notTested);
}

/** Baseline against a retest's readings (session 4, or final testing, OUT-07), with the change. */
export function retestRows(
  items: ReassessedItem[],
  readings: { key: string; limb: 'involved' | 'uninvolved' | null; value: number }[],
  notTested: Record<string, string>,
): ReassessedRow[] {
  return items.map((item) => {
    const mine = readings.filter((r) => r.key === item.measure.key);
    const now = entryOfReadings(mine);
    return {
      ...item,
      now: mine.length ? baselineReadingText(item.measure, now) : null,
      nowNotTested: notTested[item.measure.key] ?? null,
      change: mine.length ? reassessmentChangeText(item.measure, item.baselineEntry, now) : '',
    };
  });
}

/** The reassessment session's section; null for any other session. */
export async function reassessmentView(
  tx: DbOrTransaction,
  session: SessionNoteEntry,
): Promise<ReassessmentView | null> {
  const number = await getSetting('clinical.reassessment_session');
  if (session.number !== number) return null;
  const items = await reassessedItems(tx, session.episodeId, session.kbVersionId);
  const written =
    session.status === 'signed' ? await reassessmentOfSession(tx, session.id) : undefined;
  return {
    sessionNumber: number,
    reassessmentId: written?.id ?? null,
    items,
    rows: written ? await reassessedRows(tx, items, session.id, written.notTested) : null,
    decision:
      written?.decision && written.signedAt
        ? { text: written.decision, by: written.signedByName ?? '', at: written.signedAt }
        : null,
    consultantName: written?.consultantName ?? null,
  };
}
