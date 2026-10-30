import type {
  ClearanceCriterion,
  ClearanceStatus,
  CriterionResult,
  KnowledgeRegion,
  MeasureEntry,
  ReadinessCriterion,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  clearance,
  kbReadinessCriterion,
  kbVersion,
  measure,
  readinessMark,
  readinessRecording,
} from './schema';
import { liveVersionCondition } from './knowledge';
import type { DbOrTransaction } from './versioned';

/**
 * Readiness and clearances (OUT-08; docs/runbooks/sessions.md "Readiness and clearances"): the
 * region's criteria from the knowledge base, the episode's readings and the consultant's marks,
 * and the three clearances. Row level security and `internal.readiness_guard` and
 * `internal.clearance_guard` hold who writes them, when, and that nothing changes.
 */

/** The newest live knowledge base version (SET-06) holding readiness criteria for the region. */
export async function latestCriteriaVersion(
  db: DbOrTransaction,
  region: KnowledgeRegion,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: kbVersion.id })
    .from(kbVersion)
    .where(
      and(
        sql`exists (select 1 from ${kbReadinessCriterion} c
          where c.kb_version_id = ${kbVersion.id} and c.region = ${region})`,
        liveVersionCondition,
      ),
    )
    .orderBy(desc(kbVersion.number))
    .limit(1);
  return row?.id;
}

/** The region's criteria at a version, in the workbook's order. */
export function readinessCriteria(
  db: DbOrTransaction,
  kbVersionId: string,
  region: KnowledgeRegion,
): Promise<ReadinessCriterion[]> {
  return db
    .select({
      key: kbReadinessCriterion.key,
      region: kbReadinessCriterion.region,
      kind: kbReadinessCriterion.kind,
      measureKey: kbReadinessCriterion.measureKey,
      text: kbReadinessCriterion.text,
      section: kbReadinessCriterion.section,
      rule: kbReadinessCriterion.rule,
      fromVerdict: kbReadinessCriterion.fromVerdict,
    })
    .from(kbReadinessCriterion)
    .where(
      and(
        eq(kbReadinessCriterion.kbVersionId, kbVersionId),
        eq(kbReadinessCriterion.region, region),
      ),
    )
    .orderBy(asc(kbReadinessCriterion.position));
}

export const readingSources = ['consultation', 'session', 'final_test', 'readiness'] as const;
export type ReadingSource = (typeof readingSources)[number];

/** One taking of a measure: its readings from one consultation, session, test or recording. */
export interface EpisodeReading {
  entry: MeasureEntry;
  source: ReadingSource;
  takenAt: Date;
}

/**
 * Each measure's takings in the episode, by key: the newest (`latest`) and the first (`first`,
 * the same taking when there is one).
 */
export async function episodeReadings(
  db: DbOrTransaction,
  episodeId: string,
  keys: readonly string[],
): Promise<Map<string, { latest: EpisodeReading; first: EpisodeReading }>> {
  if (keys.length === 0) return new Map();
  const rows = await db
    .select({
      key: measure.measureKey,
      limb: measure.limb,
      value: measure.value,
      takenAt: measure.takenAt,
      consultationId: measure.consultationId,
      sessionId: measure.sessionId,
      finalTestId: measure.finalTestId,
      readinessRecordingId: measure.readinessRecordingId,
    })
    .from(measure)
    .where(and(eq(measure.episodeId, episodeId), inArray(measure.measureKey, [...keys])))
    .orderBy(asc(measure.takenAt));
  const takings = new Map<string, Map<string, EpisodeReading>>();
  for (const row of rows) {
    const source: ReadingSource = row.consultationId
      ? 'consultation'
      : row.sessionId
        ? 'session'
        : row.finalTestId
          ? 'final_test'
          : 'readiness';
    const from =
      row.consultationId ?? row.sessionId ?? row.finalTestId ?? row.readinessRecordingId ?? '';
    const byTaking = takings.get(row.key) ?? new Map<string, EpisodeReading>();
    const taking = byTaking.get(from) ?? { entry: {}, source, takenAt: row.takenAt };
    if (row.limb === 'involved') taking.entry.involved = row.value;
    else if (row.limb === 'uninvolved') taking.entry.uninvolved = row.value;
    else taking.entry.value = row.value;
    if (row.takenAt > taking.takenAt) taking.takenAt = row.takenAt;
    byTaking.set(from, taking);
    takings.set(row.key, byTaking);
  }
  const result = new Map<string, { latest: EpisodeReading; first: EpisodeReading }>();
  for (const [key, byTaking] of takings) {
    const ordered = [...byTaking.values()].sort(
      (a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
    );
    const first = ordered[0];
    const latest = ordered.at(-1);
    if (first && latest) result.set(key, { latest, first });
  }
  return result;
}

export interface ReadinessMarks {
  check?: { result: CriterionResult; by: string; at: Date };
  override?: { reason: string; by: string; at: Date };
}

/** The latest check and override per criterion of the episode. */
export async function readinessMarks(
  db: DbOrTransaction,
  episodeId: string,
): Promise<Map<string, ReadinessMarks>> {
  const rows = await db
    .select({
      key: readinessMark.criterionKey,
      kind: readinessMark.kind,
      result: readinessMark.result,
      reason: readinessMark.reason,
      // Through an internal function: a record is read at any centre (CLN-12).
      by: sql<string>`coalesce(internal.record_staff_name(${readinessMark.markedBy}), '')`,
      at: readinessMark.markedAt,
    })
    .from(readinessMark)
    .where(eq(readinessMark.episodeId, episodeId))
    .orderBy(asc(readinessMark.markedAt));
  const marks = new Map<string, ReadinessMarks>();
  for (const row of rows) {
    const mark = marks.get(row.key) ?? {};
    if (row.kind === 'check' && row.result) {
      mark.check = { result: row.result, by: row.by, at: row.at };
    } else if (row.kind === 'override' && row.reason) {
      mark.override = { reason: row.reason, by: row.by, at: row.at };
    }
    marks.set(row.key, mark);
  }
  return marks;
}

/** A consultant's mark: a yes or no criterion's result, or an override with its reason. */
export async function addReadinessMark(
  tx: DbOrTransaction,
  mark: {
    episodeId: string;
    kbVersionId: string;
    criterionKey: string;
    by: string;
  } & ({ kind: 'check'; result: CriterionResult } | { kind: 'override'; reason: string }),
): Promise<void> {
  await tx.insert(readinessMark).values({
    episodeId: mark.episodeId,
    kbVersionId: mark.kbVersionId,
    criterionKey: mark.criterionKey,
    kind: mark.kind,
    result: mark.kind === 'check' ? mark.result : null,
    reason: mark.kind === 'override' ? mark.reason : null,
    markedBy: mark.by,
  });
}

/** A reading taken on the panel: the recording, then its measure rows. */
export async function recordReadinessReading(
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
  },
): Promise<string> {
  const { episodeId, kbVersionId } = values;
  const [row] = await tx
    .insert(readinessRecording)
    .values({ episodeId, kbVersionId, recordedBy: values.by })
    .returning({ id: readinessRecording.id });
  if (!row) throw new Error('The reading was not recorded.');
  await tx.insert(measure).values(
    values.readings.map((r) => ({
      episodeId,
      readinessRecordingId: row.id,
      kbVersionId,
      measureKey: r.key,
      limb: r.limb,
      value: r.value,
      unit: r.unit,
      createdBy: values.by,
    })),
  );
  return row.id;
}

export interface ClearanceRecord {
  status: ClearanceStatus;
  criteria: ClearanceCriterion[];
  signedByName: string;
  signedAt: Date;
}

/**
 * The episode's signed clearances, in their order: they are signed in order (the guard holds it),
 * and signing times can tie within one transaction.
 */
export function clearancesOf(db: DbOrTransaction, episodeId: string): Promise<ClearanceRecord[]> {
  return db
    .select({
      status: clearance.status,
      criteria: clearance.criteria,
      signedByName: sql<string>`coalesce(internal.record_staff_name(${clearance.signedBy}), '')`,
      signedAt: clearance.signedAt,
    })
    .from(clearance)
    .where(eq(clearance.episodeId, episodeId))
    .orderBy(asc(clearance.status));
}

/** Signs one clearance as the caller, keeping each criterion as it stands. */
export async function signClearance(
  tx: DbOrTransaction,
  values: {
    episodeId: string;
    status: ClearanceStatus;
    region: KnowledgeRegion;
    kbVersionId: string;
    criteria: ClearanceCriterion[];
    by: string;
    /** What the patient acknowledges (OUT-09): Return to training and Return to sport only. */
    texts?: { plan: string; warningSigns: string; residualRisk: string };
  },
): Promise<void> {
  await tx.insert(clearance).values({
    episodeId: values.episodeId,
    status: values.status,
    region: values.region,
    kbVersionId: values.kbVersionId,
    criteria: values.criteria,
    signedBy: values.by,
    patientPlan: values.texts?.plan ?? null,
    warningSigns: values.texts?.warningSigns ?? null,
    residualRisk: values.texts?.residualRisk ?? null,
  });
}
