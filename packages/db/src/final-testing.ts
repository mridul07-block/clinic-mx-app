import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { baselineMeasure, finalTest, measure, reassessment, treatmentSession } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Final testing (OUT-07, PRD J6.2; docs/runbooks/sessions.md "Final testing"): exactly the
 * episode's frozen baseline retested once on the Review and discharge screen and signed as it is
 * written, by anyone with the Consultant tick. Row level security and `internal.final_test_guard`
 * hold who signs it, when, on which episode, and that it never changes.
 */

/** The knowledge base version the episode's baseline was frozen at; undefined without one. */
export async function baselineVersionOfEpisode(
  db: DbOrTransaction,
  episodeId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ kbVersionId: baselineMeasure.kbVersionId })
    .from(baselineMeasure)
    .where(eq(baselineMeasure.episodeId, episodeId))
    .limit(1);
  return row?.kbVersionId;
}

/**
 * Signs the episode's final testing: the row (signed by the caller, now, by the database), then
 * its readings as measure rows of it. The final test's id.
 */
export async function recordFinalTest(
  tx: DbOrTransaction,
  values: {
    episodeId: string;
    kbVersionId: string;
    by: string;
    readings: {
      key: string;
      limb: 'involved' | 'uninvolved' | null;
      value: number;
      unit: string;
    }[];
    notTested: Record<string, string>;
  },
): Promise<string> {
  const { episodeId, kbVersionId } = values;
  const [row] = await tx
    .insert(finalTest)
    .values({ episodeId, kbVersionId, notTested: values.notTested, signedBy: values.by })
    .returning({ id: finalTest.id });
  if (!row) throw new Error('The final testing was not recorded.');
  if (values.readings.length > 0) {
    await tx.insert(measure).values(
      values.readings.map((r) => ({
        episodeId,
        finalTestId: row.id,
        kbVersionId,
        measureKey: r.key,
        limb: r.limb,
        value: r.value,
        unit: r.unit,
        createdBy: values.by,
      })),
    );
  }
  return row.id;
}

export interface FinalTestRecord {
  id: string;
  episodeId: string;
  kbVersionId: string;
  notTested: Record<string, string>;
  signedByName: string;
  signedAt: Date;
}

/** The episode's final testing, as the reader may read it; undefined until signed. */
export async function finalTestOfEpisode(
  db: DbOrTransaction,
  episodeId: string,
): Promise<FinalTestRecord | undefined> {
  const [row] = await db
    .select({
      id: finalTest.id,
      episodeId: finalTest.episodeId,
      kbVersionId: finalTest.kbVersionId,
      notTested: finalTest.notTested,
      // Through an internal function: a signed record is read at any centre (CLN-12).
      signedByName: sql<string>`coalesce(internal.record_staff_name(${finalTest.signedBy}), '')`,
      signedAt: finalTest.signedAt,
    })
    .from(finalTest)
    .where(eq(finalTest.episodeId, episodeId));
  return row;
}

/** A final test's readings of the given measures. */
export function finalTestReadings(
  db: DbOrTransaction,
  finalTestId: string,
  keys: string[],
): Promise<{ key: string; limb: 'involved' | 'uninvolved' | null; value: number }[]> {
  if (keys.length === 0) return Promise.resolve([]);
  return db
    .select({ key: measure.measureKey, limb: measure.limb, value: measure.value })
    .from(measure)
    .where(and(eq(measure.finalTestId, finalTestId), inArray(measure.measureKey, keys)));
}

/** The episode's session 4 reassessment (OUT-05): its session and reasons not tested. */
export async function reassessmentOfEpisode(
  db: DbOrTransaction,
  episodeId: string,
): Promise<
  { sessionId: string; sessionNumber: number; notTested: Record<string, string> } | undefined
> {
  const [row] = await db
    .select({
      sessionId: reassessment.sessionId,
      sessionNumber: treatmentSession.number,
      notTested: reassessment.notTested,
    })
    .from(reassessment)
    .innerJoin(treatmentSession, eq(treatmentSession.id, reassessment.sessionId))
    .where(eq(reassessment.episodeId, episodeId))
    .orderBy(desc(reassessment.createdAt))
    .limit(1);
  return row;
}
