import 'server-only';
import {
  addReadinessMark,
  clearanceAckForEpisode,
  clearancesOf,
  episodeReadings,
  episodeRecord,
  knowledgeObjective,
  latestCriteriaVersion,
  readinessCriteria,
  readinessMarks,
  recordReadinessReading,
  signClearance,
  staffTreatsNow,
  type DbOrTransaction,
  type EpisodeReading,
  type ReadingSource,
  type StaffMember,
} from '@clinic-mx/db';
import {
  baselineReadingText,
  can,
  clearanceRefusal,
  clearanceSignWithTextsSchema,
  isAcknowledgedClearance,
  clearanceStatusLabels,
  clearanceStatuses,
  formatIstDate,
  istDate,
  measuredResult,
  reassessmentBlockers,
  reassessmentRecordings,
  readinessCheckSchema,
  readinessOverrideSchema,
  readinessReadingSchema,
  takesFinalTest,
  type ClearanceCriterion,
  type ClearanceStatus,
  type CriterionResult,
  type KnowledgeMeasure,
  type KnowledgeRegion,
  type ReadinessCriterion,
} from '@clinic-mx/schemas';
import { staffService } from '../access/service';
import { episodeRegion } from '../sessions/baseline';
import { ReviewError } from './errors';

/**
 * The readiness panel and the three clearances (OUT-08, PRD J6.3 to J6.5; user decisions 27
 * October 2026; docs/runbooks/sessions.md "Readiness and clearances"). The region's criteria come
 * from the newest knowledge base version holding them; each measured one is judged from the
 * episode's newest reading, each yes or no one by the consultant's latest mark. A consultant with
 * both ticks marks, overrides with a reason, records a missing reading, and signs the statuses in
 * order while every criterion is Met or overridden.
 */

const sourceLabels: Record<ReadingSource, string> = {
  consultation: 'consultation',
  session: 'session',
  final_test: 'final testing',
  readiness: 'recorded here',
};

export interface ReadinessRow {
  criterion: ReadinessCriterion;
  /** The measure of a measured criterion. */
  measure: KnowledgeMeasure | null;
  /** Before any override. */
  result: CriterionResult;
  /** The newest reading, as the workbooks word it, and where and when it was taken. */
  reading: string | null;
  readingFrom: string | null;
  check: { result: CriterionResult; by: string; at: Date } | null;
  override: { reason: string; by: string; at: Date } | null;
}

export interface ReadinessClearance {
  status: ClearanceStatus;
  label: string;
  signed: { by: string; at: Date } | null;
  /** Why it cannot be signed yet; undefined when it can. */
  refusal: string | undefined;
  /**
   * The patient's acknowledgement (OUT-09) of a signed Return to training or Return to sport
   * with its sections: when, and whether a guardian signed; `at` null while it waits; `next` for
   * the one the clearance QR asks now (the newest waiting). Null where none is asked.
   */
  acknowledgement: { at: Date | null; byGuardian: boolean; next: boolean } | null;
  /** Signing asks for the sections the patient acknowledges (OUT-09). */
  asksTexts: boolean;
}

export interface ReadinessView {
  region: KnowledgeRegion;
  kbVersionId: string;
  rows: ReadinessRow[];
  clearances: ReadinessClearance[];
}

const readingText = (measure: KnowledgeMeasure, reading: EpisodeReading) =>
  baselineReadingText(measure, reading.entry);

/** The episode's region and the version and criteria judging it; undefined without either. */
async function readinessContext(tx: DbOrTransaction, episodeId: string) {
  const region = await episodeRegion(tx, episodeId);
  if (!region) return undefined;
  const kbVersionId = await latestCriteriaVersion(tx, region);
  if (!kbVersionId) return undefined;
  const criteria = await readinessCriteria(tx, kbVersionId, region);
  const catalog = (await knowledgeObjective(tx, kbVersionId)).measures;
  return { region, kbVersionId, criteria, catalog };
}

/** The panel as it stands; undefined before the consultation names a region with criteria. */
export async function readinessView(
  tx: DbOrTransaction,
  episodeId: string,
): Promise<ReadinessView | undefined> {
  const context = await readinessContext(tx, episodeId);
  if (!context) return undefined;
  const { region, kbVersionId, criteria, catalog } = context;
  const measureKeys = criteria.flatMap((c) => (c.measureKey ? [c.measureKey] : []));
  const readings = await episodeReadings(tx, episodeId, measureKeys);
  const marks = await readinessMarks(tx, episodeId);
  const rows = criteria.map((criterion): ReadinessRow => {
    const mark = marks.get(criterion.key) ?? {};
    const measure = catalog.find((m) => m.key === criterion.measureKey) ?? null;
    const taken = criterion.measureKey ? readings.get(criterion.measureKey) : undefined;
    const result: CriterionResult = measure
      ? measuredResult(criterion, measure, taken?.latest.entry, taken?.first.entry)
      : (mark.check?.result ?? 'not_assessed');
    return {
      criterion,
      measure,
      result,
      reading: measure && taken ? readingText(measure, taken.latest) : null,
      readingFrom: taken
        ? `${sourceLabels[taken.latest.source]}, ${formatIstDate(istDate(taken.latest.takenAt))}`
        : null,
      check: mark.check ?? null,
      override: mark.override ?? null,
    };
  });
  const signed = await clearancesOf(tx, episodeId);
  const states = rows.map((row) => ({
    result: row.result,
    override: row.result === 'met' ? null : (row.override?.reason ?? null),
  }));
  const signedStatuses = signed.map((c) => c.status);
  const acknowledged = (await clearanceAckForEpisode(tx, episodeId))?.clearances ?? [];
  const next = acknowledged.filter((each) => each.acknowledgedAt === null).at(-1)?.status;
  return {
    region,
    kbVersionId,
    rows,
    clearances: clearanceStatuses.map((status) => {
      const record = signed.find((c) => c.status === status);
      return {
        status,
        label: clearanceStatusLabels[status],
        signed: record ? { by: record.signedByName, at: record.signedAt } : null,
        refusal: record ? undefined : clearanceRefusal(status, signedStatuses, states),
        acknowledgement: (() => {
          const ack = acknowledged.find((each) => each.status === status);
          return ack
            ? {
                at: ack.acknowledgedAt,
                byGuardian: ack.signer === 'guardian',
                next: ack.status === next,
              }
            : null;
        })(),
        asksTexts: isAcknowledgedClearance(status),
      };
    }),
  };
}

/** Whether the reader works on the panel: both ticks, a treated episode. */
export const worksReadiness = (actor: StaffMember, status: Parameters<typeof takesFinalTest>[0]) =>
  takesFinalTest(status) && can(actor, 'consultant_records.sign');

/** The checks every write shares: the tick now, a treated episode, a region with criteria. */
async function writable(tx: DbOrTransaction, actor: StaffMember, episodeId: string) {
  if (!(await staffTreatsNow(tx, actor.id))) {
    throw new ReviewError('Readiness needs the Treats patients tick.');
  }
  const episode = await episodeRecord(tx, episodeId);
  if (!episode) throw new ReviewError('That episode was not found.');
  if (!takesFinalTest(episode.status)) {
    throw new ReviewError('Readiness is recorded while the episode is Active or Under review.');
  }
  const context = await readinessContext(tx, episodeId);
  if (!context) throw new ReviewError('This episode has no readiness criteria yet.');
  return context;
}

const criterionOf = (criteria: readonly ReadinessCriterion[], key: string) => {
  const criterion = criteria.find((c) => c.key === key);
  if (!criterion) throw new ReviewError('That is not a readiness criterion of this episode.');
  return criterion;
};

/** Marks a yes or no criterion Met, Not met or Not assessed. */
export const markReadinessCheck = staffService({
  action: 'consultant_records.sign',
  input: readinessCheckSchema,
  run: async (tx, input, actor): Promise<{ status: 'marked' }> => {
    const { kbVersionId, criteria } = await writable(tx, actor, input.episodeId);
    const criterion = criterionOf(criteria, input.criterionKey);
    if (criterion.kind !== 'check') {
      throw new ReviewError('A measured criterion is judged by its reading.');
    }
    await addReadinessMark(tx, {
      episodeId: input.episodeId,
      kbVersionId,
      criterionKey: criterion.key,
      by: actor.id,
      kind: 'check',
      result: input.result,
    });
    return { status: 'marked' };
  },
});

/** Overrides a criterion that is not Met, with the written reason. */
export const overrideReadinessCriterion = staffService({
  action: 'consultant_records.sign',
  input: readinessOverrideSchema,
  run: async (tx, input, actor): Promise<{ status: 'overridden' }> => {
    const { kbVersionId, criteria } = await writable(tx, actor, input.episodeId);
    const criterion = criterionOf(criteria, input.criterionKey);
    const view = await readinessView(tx, input.episodeId);
    if (view?.rows.find((row) => row.criterion.key === criterion.key)?.result === 'met') {
      throw new ReviewError('This criterion is Met; there is nothing to override.');
    }
    await addReadinessMark(tx, {
      episodeId: input.episodeId,
      kbVersionId,
      criterionKey: criterion.key,
      by: actor.id,
      kind: 'override',
      reason: input.reason,
    });
    return { status: 'overridden' };
  },
});

/** Records a reading for a measured criterion the episode has never measured. */
export const recordReadinessMeasure = staffService({
  action: 'consultant_records.sign',
  input: readinessReadingSchema,
  run: async (tx, input, actor): Promise<{ status: 'recorded' }> => {
    const { kbVersionId, criteria, catalog } = await writable(tx, actor, input.episodeId);
    const criterion = criterionOf(criteria, input.criterionKey);
    const measure = catalog.find((m) => m.key === criterion.measureKey);
    if (!measure) throw new ReviewError('A yes or no criterion is marked, not measured.');
    const taken = await episodeReadings(tx, input.episodeId, [measure.key]);
    if (taken.has(measure.key)) {
      throw new ReviewError('This criterion is judged from its reading already.');
    }
    const entry = { ...input, notTested: false, reason: '' };
    const blockers = reassessmentBlockers({ [measure.key]: entry }, [measure]);
    if (blockers[0]) throw new ReviewError(blockers[0]);
    const { readings } = reassessmentRecordings({ [measure.key]: entry }, [measure]);
    await recordReadinessReading(tx, {
      episodeId: input.episodeId,
      kbVersionId,
      by: actor.id,
      readings,
    });
    return { status: 'recorded' };
  },
});

/** Signs one clearance, in order, keeping every criterion as it stands. */
export const signReadinessClearance = staffService({
  action: 'consultant_records.sign',
  input: clearanceSignWithTextsSchema,
  run: async (tx, input, actor): Promise<{ status: 'signed' }> => {
    const { region, kbVersionId } = await writable(tx, actor, input.episodeId);
    const view = await readinessView(tx, input.episodeId);
    const status = view?.clearances.find((c) => c.status === input.status);
    if (!view || !status) throw new ReviewError('This episode has no readiness criteria yet.');
    if (status.signed) throw new ReviewError(`${status.label} is signed already.`);
    if (status.refusal) throw new ReviewError(status.refusal);
    const criteria = view.rows.map((row): ClearanceCriterion => ({
      key: row.criterion.key,
      text: row.criterion.text,
      result: row.result,
      reading: row.reading,
      override: row.result === 'met' ? null : (row.override?.reason ?? null),
    }));
    await signClearance(tx, {
      episodeId: input.episodeId,
      status: input.status,
      region,
      kbVersionId,
      criteria,
      by: actor.id,
      // OUT-09: what the patient acknowledges; Rehabilitation complete has none.
      ...(input.texts && isAcknowledgedClearance(input.status) ? { texts: input.texts } : {}),
    });
    return { status: 'signed' };
  },
});
