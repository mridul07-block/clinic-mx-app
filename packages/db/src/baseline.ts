import type { BaselineRecording, TakenMeasure } from '@clinic-mx/schemas';
import { and, asc, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { baselineMeasure, consultation, measure } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The episode's baseline (OUT-01; docs/runbooks/sessions.md "Baseline"): what session 1 reads to
 * work it out, and what its signing writes. The rows are written only while session 1 is being
 * signed, by its physio, and never change; row level security holds that, and that a reused
 * reading is the episode's signed consultation's, taken within `clinical.baseline_reuse_days`.
 */

/** The episode's newest signed consultation: its sections and its visit (for the health form). */
export async function signedConsultationOf(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ id: string; appointmentId: string; sections: Record<string, unknown> } | undefined> {
  const [row] = await db
    .select({
      id: consultation.id,
      appointmentId: consultation.appointmentId,
      sections: consultation.sections,
    })
    .from(consultation)
    .where(and(eq(consultation.episodeId, episodeId), eq(consultation.status, 'signed')))
    .orderBy(desc(consultation.signedAt))
    .limit(1);
  return row;
}

/** The episode's signed consultations' measure rows taken between `from` and `to`. */
export function consultationMeasuresBetween(
  db: DbOrTransaction,
  episodeId: string,
  from: Date,
  to: Date,
): Promise<TakenMeasure[]> {
  return db
    .select({
      key: measure.measureKey,
      limb: measure.limb,
      value: measure.value,
      takenAt: measure.takenAt,
      consultationId: consultation.id,
    })
    .from(measure)
    .innerJoin(consultation, eq(consultation.id, measure.consultationId))
    .where(
      and(
        eq(measure.episodeId, episodeId),
        eq(consultation.status, 'signed'),
        gte(measure.takenAt, from),
        lte(measure.takenAt, to),
      ),
    )
    .orderBy(asc(measure.takenAt));
}

/**
 * Session 1's signing (OUT-01): the markers it recorded as its own measure rows, then one baseline
 * row per measure, reused, recorded or not tested. Run in the signing transaction, after it.
 */
export async function recordBaseline(
  tx: DbOrTransaction,
  baseline: {
    sessionId: string;
    episodeId: string;
    kbVersionId: string;
    by: string;
    reused: { key: string; consultationId: string }[];
    recordings: BaselineRecording[];
  },
): Promise<void> {
  const { sessionId, episodeId, kbVersionId } = baseline;
  const values = baseline.recordings.flatMap((r) => ('value' in r ? [r] : []));
  if (values.length > 0) {
    await tx.insert(measure).values(
      values.map((r) => ({
        episodeId,
        sessionId,
        kbVersionId,
        measureKey: r.key,
        value: r.value,
        unit: r.unit,
        createdBy: baseline.by,
      })),
    );
  }
  const rows = [
    ...baseline.reused.map((r) => ({ measureKey: r.key, consultationId: r.consultationId })),
    ...baseline.recordings.map((r) => ({
      measureKey: r.key,
      notTestedReason: 'notTestedReason' in r ? r.notTestedReason : null,
    })),
  ];
  if (rows.length === 0) return;
  await tx
    .insert(baselineMeasure)
    .values(rows.map((row) => ({ episodeId, sessionId, kbVersionId, ...row })));
}

export interface FrozenBaselineMeasure {
  key: string;
  /** Where the reading was taken: a consultation's id, or null for session 1 itself. */
  consultationId: string | null;
  notTestedReason: string | null;
  readings: { limb: 'involved' | 'uninvolved' | null; value: number; takenAt: Date }[];
}

/** The baseline session 1's signing wrote, with each measure's readings; empty before then. */
export async function frozenBaseline(
  db: DbOrTransaction,
  sessionId: string,
): Promise<FrozenBaselineMeasure[]> {
  const rows = await db
    .select({
      key: baselineMeasure.measureKey,
      consultationId: baselineMeasure.consultationId,
      notTestedReason: baselineMeasure.notTestedReason,
    })
    .from(baselineMeasure)
    .where(eq(baselineMeasure.sessionId, sessionId));
  if (rows.length === 0) return [];
  const keys = rows.map((row) => row.key);
  const consultationIds = rows.flatMap((row) => (row.consultationId ? [row.consultationId] : []));
  const readings = await db
    .select({
      key: measure.measureKey,
      consultationId: measure.consultationId,
      sessionId: measure.sessionId,
      limb: measure.limb,
      value: measure.value,
      takenAt: measure.takenAt,
    })
    .from(measure)
    .where(
      and(
        inArray(measure.measureKey, keys),
        consultationIds.length > 0
          ? or(inArray(measure.consultationId, consultationIds), eq(measure.sessionId, sessionId))
          : eq(measure.sessionId, sessionId),
      ),
    );
  return rows.map((row) => ({
    ...row,
    readings: readings
      .filter(
        (r) =>
          r.key === row.key &&
          (row.consultationId
            ? r.consultationId === row.consultationId
            : row.notTestedReason === null && r.sessionId === sessionId),
      )
      .map(({ limb, value, takenAt }) => ({ limb, value, takenAt })),
  }));
}
