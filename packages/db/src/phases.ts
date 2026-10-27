import type {
  KnowledgeRegion,
  PhaseCriterion,
  PhaseMark,
  PhaseMarkResult,
  PhaseMove,
  PhaseMoveKind,
  ProgrammePhase,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { kbPhase, kbPhaseCriterion, kbVersion, phaseMark, phaseMove } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The phased programme (OUT-04 with SET-09; docs/runbooks/sessions.md "Phase stepper"): each
 * region's phases and exit criteria from the knowledge base, and the episode's marks and moves.
 * Row level security and `internal.phase_guard` hold who writes them, when, and that nothing
 * changes.
 */

/** The newest knowledge base version holding phases for the region. */
export async function latestPhaseVersion(
  db: DbOrTransaction,
  region: KnowledgeRegion,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: kbVersion.id })
    .from(kbVersion)
    .where(
      sql`exists (select 1 from ${kbPhase} p
        where p.kb_version_id = ${kbVersion.id} and p.region = ${region})`,
    )
    .orderBy(desc(kbVersion.number))
    .limit(1);
  return row?.id;
}

/** The region's phases and exit criteria at a version, in order. */
export async function regionProgramme(
  db: DbOrTransaction,
  kbVersionId: string,
  region: KnowledgeRegion,
): Promise<{ phases: ProgrammePhase[]; criteria: PhaseCriterion[] }> {
  const phases = await db
    .select({
      region: kbPhase.region,
      number: kbPhase.number,
      name: kbPhase.name,
      timing: kbPhase.timing,
      goal: kbPhase.goal,
      content: kbPhase.content,
      markers: kbPhase.markers,
    })
    .from(kbPhase)
    .where(and(eq(kbPhase.kbVersionId, kbVersionId), eq(kbPhase.region, region)))
    .orderBy(asc(kbPhase.number));
  const criteria = await db
    .select({
      key: kbPhaseCriterion.key,
      region: kbPhaseCriterion.region,
      phase: kbPhaseCriterion.phase,
      position: kbPhaseCriterion.position,
      text: kbPhaseCriterion.text,
      namesPainLimit: kbPhaseCriterion.namesPainLimit,
    })
    .from(kbPhaseCriterion)
    .where(and(eq(kbPhaseCriterion.kbVersionId, kbVersionId), eq(kbPhaseCriterion.region, region)))
    .orderBy(asc(kbPhaseCriterion.phase), asc(kbPhaseCriterion.position));
  return { phases, criteria };
}

export interface EpisodePhaseRecords {
  /** The version and region the episode follows, once anything is recorded; else undefined. */
  programme: { kbVersionId: string; region: KnowledgeRegion } | undefined;
  marks: PhaseMark[];
  moves: PhaseMove[];
}

/** The episode's marks and moves, oldest first. */
export async function episodePhaseRecords(
  db: DbOrTransaction,
  episodeId: string,
): Promise<EpisodePhaseRecords> {
  const moves = await db
    .select({
      kbVersionId: phaseMove.kbVersionId,
      region: phaseMove.region,
      fromPhase: phaseMove.fromPhase,
      toPhase: phaseMove.toPhase,
      kind: phaseMove.kind,
      reason: phaseMove.reason,
      movedAt: phaseMove.movedAt,
      // Through an internal function: a record is read at any centre (CLN-12).
      movedByName: sql<string>`coalesce(internal.record_staff_name(${phaseMove.movedBy}), '')`,
    })
    .from(phaseMove)
    .where(eq(phaseMove.episodeId, episodeId))
    .orderBy(asc(phaseMove.movedAt));
  const marks = await db
    .select({
      kbVersionId: phaseMark.kbVersionId,
      region: kbPhaseCriterion.region,
      criterionKey: phaseMark.criterionKey,
      result: phaseMark.result,
      markedAt: phaseMark.markedAt,
    })
    .from(phaseMark)
    .innerJoin(
      kbPhaseCriterion,
      and(
        eq(kbPhaseCriterion.kbVersionId, phaseMark.kbVersionId),
        eq(kbPhaseCriterion.key, phaseMark.criterionKey),
      ),
    )
    .where(eq(phaseMark.episodeId, episodeId))
    .orderBy(asc(phaseMark.markedAt));
  const first = moves[0] ?? marks[0];
  return {
    programme: first ? { kbVersionId: first.kbVersionId, region: first.region } : undefined,
    marks: marks.map(({ criterionKey, result, markedAt }) => ({ criterionKey, result, markedAt })),
    moves: moves.map(({ kbVersionId: _v, region: _r, ...move }) => move),
  };
}

/** The episode's treating physio: the newest plan version's, as the guard reads it. */
export async function episodeTreatingPhysio(
  db: DbOrTransaction,
  episodeId: string,
): Promise<string | null> {
  const [row] = await db.execute<{ id: string | null }>(
    sql`select internal.episode_treating_physio(${episodeId}) as id`,
  );
  return row?.id ?? null;
}

/** The treating physio's mark on an exit criterion of the current phase. */
export async function addPhaseMark(
  tx: DbOrTransaction,
  mark: {
    episodeId: string;
    kbVersionId: string;
    criterionKey: string;
    result: PhaseMarkResult;
    by: string;
  },
): Promise<void> {
  await tx.insert(phaseMark).values({
    episodeId: mark.episodeId,
    kbVersionId: mark.kbVersionId,
    criterionKey: mark.criterionKey,
    result: mark.result,
    markedBy: mark.by,
  });
}

/** A move between phases: the treating physio's progress, or a consultant's override. */
export async function addPhaseMove(
  tx: DbOrTransaction,
  move: {
    episodeId: string;
    kbVersionId: string;
    region: KnowledgeRegion;
    fromPhase: number;
    toPhase: number;
    kind: PhaseMoveKind;
    reason: string | null;
    by: string;
  },
): Promise<void> {
  await tx.insert(phaseMove).values({
    episodeId: move.episodeId,
    kbVersionId: move.kbVersionId,
    region: move.region,
    fromPhase: move.fromPhase,
    toPhase: move.toPhase,
    kind: move.kind,
    reason: move.reason,
    movedBy: move.by,
  });
}
