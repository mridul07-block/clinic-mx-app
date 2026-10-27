import 'server-only';
import {
  addPhaseMark,
  addPhaseMove,
  episodePhaseRecords,
  episodeRecord,
  episodeTreatingPhysio,
  latestPhaseVersion,
  regionProgramme,
  staffTreatsNow,
  type DbOrTransaction,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  noPhasedProgramme,
  painLimitHint,
  phaseLine,
  phaseMarkSchema,
  phaseNotSetUp,
  phaseOverrideSchema,
  phaseProgressSchema,
  phaseStepper,
  progressRefusal,
  takesFinalTest,
  type EpisodeStatus,
  type KnowledgeRegion,
  type PhaseMove,
  type Stepper,
} from '@clinic-mx/schemas';
import { staffService } from '../access/service';
import { episodeRegion } from '../sessions/baseline';
import { getSetting } from '../settings/settings';

/**
 * The phase stepper (OUT-04 with SET-09, PRD J5.11; user decisions 27 October 2026;
 * docs/runbooks/sessions.md "Phase stepper"). The episode follows its region's phased programme
 * from the newest knowledge base version holding one (kept once anything is recorded). It starts
 * in Phase 0; the treating physio marks each exit criterion of the current phase and moves the
 * patient on once every one is Met; a consultant with the Treats patients tick moves it to any
 * other phase with a written reason. The database holds the same rules (`internal.phase_guard`).
 */

export class PhaseError extends Error {
  override name = 'PhaseError';
}

interface Programme {
  kbVersionId: string;
  region: KnowledgeRegion;
  stepper: Stepper;
  moves: PhaseMove[];
}

/** The episode's programme and stepper; undefined before a region, or when it has no phases. */
async function programmeOf(
  tx: DbOrTransaction,
  episodeId: string,
): Promise<{ region: KnowledgeRegion | ''; programme: Programme | undefined }> {
  const records = await episodePhaseRecords(tx, episodeId);
  const region = records.programme?.region ?? (await episodeRegion(tx, episodeId));
  if (!region) return { region, programme: undefined };
  const kbVersionId = records.programme?.kbVersionId ?? (await latestPhaseVersion(tx, region));
  if (!kbVersionId) return { region, programme: undefined };
  const { phases, criteria } = await regionProgramme(tx, kbVersionId, region);
  return {
    region,
    programme: {
      kbVersionId,
      region,
      stepper: phaseStepper(phases, criteria, records.marks, records.moves),
      moves: records.moves,
    },
  };
}

export interface PhasesView {
  /** Before the consultation names a region, or a workbook with no phases: why, in words. */
  missing: string | null;
  stepper: Stepper | null;
  /** Newest first. */
  history: PhaseMove[];
  /** The treating physio on a treated episode: marks and moves on. */
  marks: boolean;
  /** Why moving on is refused now; null when it is allowed (or not the reader's to do). */
  refusal: string | null;
  /** A consultant with the Treats patients tick on a treated episode. */
  overrides: boolean;
  /** Beside an exit line naming acceptable pain (decision 4). */
  painHint: string;
}

/**
 * The stepper for the Progress tab, read in the caller's transaction under row level security.
 * `latestPain` is the newest signed session's pain during activity.
 */
export async function phasesView(
  tx: DbOrTransaction,
  actor: StaffMember,
  episode: { id: string; status: EpisodeStatus },
  latestPain: { value: number; session: number } | null,
): Promise<PhasesView> {
  const { region, programme } = await programmeOf(tx, episode.id);
  const painHint = painLimitHint(await getSetting('clinical.acceptable_exercise_pain'), latestPain);
  if (!programme) {
    return {
      missing: region
        ? 'This workbook has no phased programme.'
        : 'The phases start once the consultation names the region.',
      stepper: null,
      history: [],
      marks: false,
      refusal: null,
      overrides: false,
      painHint,
    };
  }
  const treated = takesFinalTest(episode.status) && !actor.support;
  const marks =
    treated &&
    can(actor, 'session_notes.write') &&
    (await episodeTreatingPhysio(tx, episode.id)) === actor.id;
  return {
    missing: null,
    stepper: programme.stepper,
    history: [...programme.moves].reverse(),
    marks,
    refusal: marks ? progressRefusal(programme.stepper) : null,
    overrides: treated && can(actor, 'consultant_records.sign'),
    painHint,
  };
}

/** The summary card's phase line for the episode. */
export async function episodePhaseLine(tx: DbOrTransaction, episodeId: string): Promise<string> {
  const { region, programme } = await programmeOf(tx, episodeId);
  if (programme) return phaseLine(programme.stepper);
  return region ? noPhasedProgramme : phaseNotSetUp;
}

/** The checks every write shares: a treated episode with a programme. */
async function writable(tx: DbOrTransaction, episodeId: string) {
  const episode = await episodeRecord(tx, episodeId);
  if (!episode) throw new PhaseError('That episode was not found.');
  if (!takesFinalTest(episode.status)) {
    throw new PhaseError('The phase moves only while the episode is Active or Under review.');
  }
  const { programme } = await programmeOf(tx, episodeId);
  if (!programme) throw new PhaseError('This episode has no phased programme.');
  return programme;
}

async function treatingPhysio(tx: DbOrTransaction, actor: StaffMember, episodeId: string) {
  if ((await episodeTreatingPhysio(tx, episodeId)) !== actor.id) {
    throw new PhaseError('Only the treating physio does this.');
  }
}

/** The treating physio marks an exit criterion of the current phase Met or Not yet. */
export const markPhaseCriterion = staffService({
  action: 'session_notes.write',
  input: phaseMarkSchema,
  run: async (tx, input, actor): Promise<{ status: 'marked' }> => {
    const programme = await writable(tx, input.episodeId);
    await treatingPhysio(tx, actor, input.episodeId);
    const current = programme.stepper.phases.find((p) => p.state === 'current');
    if (!current?.lines.some((line) => line.key === input.criterionKey)) {
      throw new PhaseError('That is not an exit criterion of the current phase.');
    }
    await addPhaseMark(tx, {
      episodeId: input.episodeId,
      kbVersionId: programme.kbVersionId,
      criterionKey: input.criterionKey,
      result: input.result,
      by: actor.id,
    });
    return { status: 'marked' };
  },
});

/** The treating physio moves the patient on one phase, once every exit criterion is Met. */
export const progressPhase = staffService({
  action: 'session_notes.write',
  input: phaseProgressSchema,
  run: async (tx, input, actor): Promise<{ status: 'moved' }> => {
    const programme = await writable(tx, input.episodeId);
    await treatingPhysio(tx, actor, input.episodeId);
    const { stepper } = programme;
    if (input.toPhase !== stepper.current + 1) {
      throw new PhaseError('The phase has changed. Reload the page.');
    }
    const refusal = progressRefusal(stepper);
    if (refusal) throw new PhaseError(refusal);
    await addPhaseMove(tx, {
      episodeId: input.episodeId,
      kbVersionId: programme.kbVersionId,
      region: programme.region,
      fromPhase: stepper.current,
      toPhase: input.toPhase,
      kind: 'progress',
      reason: null,
      by: actor.id,
    });
    return { status: 'moved' };
  },
});

/** A consultant moves the episode to any other phase, with the written reason. */
export const overridePhase = staffService({
  action: 'consultant_records.sign',
  input: phaseOverrideSchema,
  run: async (tx, input, actor): Promise<{ status: 'moved' }> => {
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new PhaseError('A phase override needs the Treats patients tick.');
    }
    const programme = await writable(tx, input.episodeId);
    const { stepper } = programme;
    if (input.toPhase === stepper.current) {
      throw new PhaseError(`The patient is in Phase ${String(stepper.current)} already.`);
    }
    if (!stepper.phases.some((p) => p.number === input.toPhase)) {
      throw new PhaseError('That phase is not in the programme.');
    }
    await addPhaseMove(tx, {
      episodeId: input.episodeId,
      kbVersionId: programme.kbVersionId,
      region: programme.region,
      fromPhase: stepper.current,
      toPhase: input.toPhase,
      kind: 'override',
      reason: input.reason,
      by: actor.id,
    });
    return { status: 'moved' };
  },
});
