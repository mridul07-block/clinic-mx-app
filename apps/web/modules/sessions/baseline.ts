import 'server-only';
import {
  consultationIntake,
  consultationMeasuresBetween,
  frozenBaseline,
  knowledgeObjective,
  signedConsultationOf,
  type DbOrTransaction,
  type SessionNoteEntry,
} from '@clinic-mx/db';
import {
  baselineReadingText,
  baselineWindowStart,
  consultationRegion,
  consultationSectionsSchema,
  entryOfReadings,
  episodeBaseline,
  type EpisodeBaseline,
  type KnowledgeMeasure,
  type KnowledgeRegion,
  type MeasureKind,
} from '@clinic-mx/schemas';
import { getSetting } from '../settings/settings';

/**
 * The baseline at session 1 (OUT-01, PRD J5.3; docs/runbooks/sessions.md "Baseline"): while the
 * note is a draft, worked out from the episode's signed consultation, its region's markers and
 * `clinical.baseline_reuse_days`; once signed, what the signing froze.
 */

export interface BaselineItem {
  key: string;
  name: string;
  kind: MeasureKind;
  unit: string;
  direction: string | null;
  /**
   * Reused from the consultation, recorded at session 1, not tested, or (in a draft) still asked
   * for.
   */
  source: 'consultation' | 'session' | 'not_tested' | 'requested';
  /** The reading as the consultation shows it; null when asked for or not tested. */
  reading: string | null;
  takenAt: Date | null;
  reason: string | null;
}

export interface BaselineView {
  reuseDays: number;
  items: BaselineItem[];
}

const describe = (measure: KnowledgeMeasure) => ({
  key: measure.key,
  name: measure.name,
  kind: measure.kind,
  unit: measure.unit,
  direction: measure.direction,
});

/**
 * The workbook region the episode's signed consultation measured (its Objective's region, or else
 * the screening region); '' before it is signed or without one.
 */
export async function episodeRegion(
  tx: DbOrTransaction,
  episodeId: string,
): Promise<KnowledgeRegion | ''> {
  const signed = await signedConsultationOf(tx, episodeId);
  if (!signed) return '';
  const sections = consultationSectionsSchema.safeParse(signed.sections);
  const intake = await consultationIntake(tx, signed.appointmentId);
  return consultationRegion(
    sections.success ? sections.data : consultationSectionsSchema.parse({}),
    intake?.answers ?? {},
  );
}

/** Session 1's baseline as it stands: what is reused and which markers are asked for. */
export async function workedOutBaseline(
  tx: DbOrTransaction,
  session: SessionNoteEntry,
): Promise<EpisodeBaseline> {
  const reuseDays = await getSetting('clinical.baseline_reuse_days');
  const catalog = (await knowledgeObjective(tx, session.kbVersionId)).measures;
  const region = await episodeRegion(tx, session.episodeId);
  const taken = await consultationMeasuresBetween(
    tx,
    session.episodeId,
    baselineWindowStart(session.startedAt, reuseDays),
    session.startedAt,
  );
  return episodeBaseline({
    catalog,
    region,
    taken,
    startedAt: session.startedAt,
    reuseDays,
  });
}

/** The baseline section of session 1's screen; null for any other session. */
export async function baselineView(
  tx: DbOrTransaction,
  session: SessionNoteEntry,
): Promise<BaselineView | null> {
  if (session.number !== 1) return null;
  const reuseDays = await getSetting('clinical.baseline_reuse_days');
  if (session.status === 'draft') {
    const { reused, missing } = await workedOutBaseline(tx, session);
    return {
      reuseDays,
      items: [
        ...reused.map((r): BaselineItem => ({
          ...describe(r.measure),
          source: 'consultation',
          reading: baselineReadingText(r.measure, r.entry),
          takenAt: r.takenAt,
          reason: null,
        })),
        ...missing.map((m): BaselineItem => ({
          ...describe(m),
          source: 'requested',
          reading: null,
          takenAt: null,
          reason: null,
        })),
      ],
    };
  }
  const catalog = (await knowledgeObjective(tx, session.kbVersionId)).measures;
  const frozen = await frozenBaseline(tx, session.id);
  return {
    reuseDays,
    // In the workbook's order, as while it was a draft.
    items: catalog.flatMap((measure): BaselineItem[] => {
      const row = frozen.find((r) => r.key === measure.key);
      if (!row) return [];
      const reading = row.readings.length
        ? baselineReadingText(measure, entryOfReadings(row.readings))
        : null;
      return [
        {
          ...describe(measure),
          source: row.notTestedReason
            ? 'not_tested'
            : row.consultationId
              ? 'consultation'
              : 'session',
          reading,
          takenAt: row.readings[0]?.takenAt ?? null,
          reason: row.notTestedReason,
        },
      ];
    }),
  };
}
