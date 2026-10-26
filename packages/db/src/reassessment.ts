import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { frozenBaseline, type FrozenBaselineMeasure } from './baseline';
import { baselineMeasure, measure, reassessment, treatmentSession } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The session 4 reassessment (OUT-05; docs/runbooks/sessions.md "Session 4 reassessment"):
 * written while its physio signs session `clinical.reassessment_session`, then signed by the
 * episode's consultant with a written decision. Row level security and the reassessment guard
 * hold who writes and signs it, when, and that nothing else changes.
 */

/** The baseline session 1 froze for the episode (OUT-01); empty without one. */
export async function frozenBaselineOfEpisode(
  db: DbOrTransaction,
  episodeId: string,
): Promise<FrozenBaselineMeasure[]> {
  const [first] = await db
    .select({ sessionId: baselineMeasure.sessionId })
    .from(baselineMeasure)
    .where(eq(baselineMeasure.episodeId, episodeId))
    .limit(1);
  return first ? frozenBaseline(db, first.sessionId) : [];
}

/**
 * Session 4's signing: its readings as measure rows of the session, then the reassessment, whose
 * consultant the database stamps. Run in the signing transaction, after it; the reassessment id.
 */
export async function recordReassessment(
  tx: DbOrTransaction,
  values: {
    sessionId: string;
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
  const { sessionId, episodeId, kbVersionId } = values;
  if (values.readings.length > 0) {
    await tx.insert(measure).values(
      values.readings.map((r) => ({
        episodeId,
        sessionId,
        kbVersionId,
        measureKey: r.key,
        limb: r.limb,
        value: r.value,
        unit: r.unit,
        createdBy: values.by,
      })),
    );
  }
  const [row] = await tx
    .insert(reassessment)
    .values({
      episodeId,
      sessionId,
      kbVersionId,
      // The database stamps the episode's consultant (`internal.reassessment_guard`).
      consultantId: sql`null`,
      notTested: values.notTested,
    })
    .returning({ id: reassessment.id });
  if (!row) throw new Error('The reassessment was not recorded.');
  return row.id;
}

export interface ReassessmentRecord {
  id: string;
  episodeId: string;
  sessionId: string;
  kbVersionId: string;
  consultantId: string;
  consultantName: string;
  notTested: Record<string, string>;
  decision: string | null;
  signedByName: string | null;
  signedAt: Date | null;
  createdAt: Date;
  sessionNumber: number;
  appointmentId: string;
}

const columns = {
  id: reassessment.id,
  episodeId: reassessment.episodeId,
  sessionId: reassessment.sessionId,
  kbVersionId: reassessment.kbVersionId,
  consultantId: reassessment.consultantId,
  // Names through internal functions: a signed record is read at any centre (CLN-12).
  consultantName: sql<string>`coalesce(internal.record_staff_name(${reassessment.consultantId}), '')`,
  notTested: reassessment.notTested,
  decision: reassessment.decision,
  signedByName: sql<string | null>`internal.record_staff_name(${reassessment.signedBy})`,
  signedAt: reassessment.signedAt,
  createdAt: reassessment.createdAt,
  sessionNumber: treatmentSession.number,
  appointmentId: treatmentSession.appointmentId,
};

/** A reassessment by its id, as the reader may read it. */
export async function reassessmentById(
  db: DbOrTransaction,
  id: string,
): Promise<ReassessmentRecord | undefined> {
  const [row] = await db
    .select(columns)
    .from(reassessment)
    .innerJoin(treatmentSession, eq(treatmentSession.id, reassessment.sessionId))
    .where(eq(reassessment.id, id));
  return row;
}

/** The reassessment a session's signing wrote, if any. */
export async function reassessmentOfSession(
  db: DbOrTransaction,
  sessionId: string,
): Promise<ReassessmentRecord | undefined> {
  const [row] = await db
    .select(columns)
    .from(reassessment)
    .innerJoin(treatmentSession, eq(treatmentSession.id, reassessment.sessionId))
    .where(eq(reassessment.sessionId, sessionId));
  return row;
}

/** A session's own readings of the given measures. */
export function sessionReadings(
  db: DbOrTransaction,
  sessionId: string,
  keys: string[],
): Promise<{ key: string; limb: 'involved' | 'uninvolved' | null; value: number }[]> {
  if (keys.length === 0) return Promise.resolve([]);
  return db
    .select({ key: measure.measureKey, limb: measure.limb, value: measure.value })
    .from(measure)
    .where(and(eq(measure.sessionId, sessionId), inArray(measure.measureKey, keys)));
}

/** Signs the decision as the consultant, once; 'refused' when it is not theirs or signed already. */
export async function signReassessment(
  tx: DbOrTransaction,
  sign: { id: string; decision: string; by: string },
): Promise<'signed' | 'refused'> {
  const [row] = await tx
    .update(reassessment)
    .set({ decision: sign.decision, signedBy: sign.by, signedAt: sql`now()` })
    .where(and(eq(reassessment.id, sign.id), isNull(reassessment.signedAt)))
    .returning({ id: reassessment.id });
  return row ? 'signed' : 'refused';
}
