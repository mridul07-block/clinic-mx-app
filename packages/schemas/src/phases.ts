import { z } from 'zod';
import type { KnowledgeRegion } from './knowledge';

/**
 * The phased programme (OUT-04 with SET-09, PRD J5.11 and M10; user decisions 27 October 2026;
 * docs/runbooks/sessions.md "Phase stepper"). Each region's phases come from its workbook's
 * "Phased Programme" sheet, imported as versioned knowledge (`kb_phase`, `kb_phase_criterion`):
 * Phase 0 to 4, each exit criterion one line of the sheet's Exit Criteria, word for word. An
 * episode starts in Phase 0 when its plan is Active. The treating physio marks each exit line of
 * the current phase Met or Not yet and moves on one phase once every line is Met; a consultant
 * moves it to any phase with a written reason. Marks count only since the episode entered the
 * phase. The Bone Stress workbook has no phased programme (DECISION OUT-04).
 */

/** A phase as the knowledge base holds it (`kb_phase`), word for word. */
export interface ProgrammePhase {
  region: KnowledgeRegion;
  number: number;
  name: string;
  timing: string;
  goal: string;
  content: string;
  markers: string;
}

/** An exit criterion of a phase (`kb_phase_criterion`): one line of the sheet's Exit Criteria. */
export interface PhaseCriterion {
  /** `<region>.phase<n>.<slug>`. */
  key: string;
  region: KnowledgeRegion;
  phase: number;
  /** The line's order within the phase. */
  position: number;
  text: string;
  /** The line names an acceptable pain on loading: the stepper shows the latest pain beside it. */
  namesPainLimit: boolean;
}

export const phaseMarkResults = ['met', 'not_yet'] as const;
export type PhaseMarkResult = (typeof phaseMarkResults)[number];
export const phaseMarkResultLabels: Record<PhaseMarkResult, string> = {
  met: 'Met',
  not_yet: 'Not yet',
};

export const phaseMoveKinds = ['progress', 'override'] as const;
export type PhaseMoveKind = (typeof phaseMoveKinds)[number];

export interface PhaseMark {
  criterionKey: string;
  result: PhaseMarkResult;
  markedAt: Date;
}

export interface PhaseMove {
  fromPhase: number;
  toPhase: number;
  kind: PhaseMoveKind;
  reason: string | null;
  movedAt: Date;
  movedByName: string;
}

export const PHASE_REASON_MAX = 1000;

const criterionKey = z
  .string()
  .regex(/^[a-z_]+\.phase\d\.[a-z0-9_]+$/)
  .max(160);

/** The treating physio's mark on an exit line of the current phase. */
export const phaseMarkSchema = z.object({
  episodeId: z.guid(),
  criterionKey,
  result: z.enum(phaseMarkResults, { error: 'Choose Met or Not yet.' }),
});
export type PhaseMarkInput = z.infer<typeof phaseMarkSchema>;

/** The treating physio moving on one phase; `toPhase` guards against a stale screen. */
export const phaseProgressSchema = z.object({
  episodeId: z.guid(),
  toPhase: z.int().min(1).max(20),
});
export type PhaseProgressInput = z.infer<typeof phaseProgressSchema>;

/** A consultant moving the episode to any other phase, with the written reason. */
export const phaseOverrideSchema = z.object({
  episodeId: z.guid(),
  toPhase: z.int('Choose the phase.').min(0, 'Choose the phase.').max(20),
  reason: z
    .string()
    .trim()
    .min(1, 'Say why the phase is moved.')
    .max(
      PHASE_REASON_MAX,
      `Keep the reason to ${PHASE_REASON_MAX.toLocaleString('en-IN')} characters.`,
    ),
});
export type PhaseOverrideInput = z.infer<typeof phaseOverrideSchema>;

/** The episode's phase: where the newest move took it, else Phase 0. */
export const currentPhaseOf = (moves: readonly PhaseMove[]) => moves.at(-1)?.toPhase ?? 0;

/** `skipped`: an earlier phase the patient never moved on from (a consultant's override past it). */
export type StepState = 'done' | 'skipped' | 'current' | 'locked';

export interface StepperLine {
  key: string;
  text: string;
  result: PhaseMarkResult | null;
  namesPainLimit: boolean;
}

export interface StepperPhase extends ProgrammePhase {
  state: StepState;
  /** The current phase's exit lines with their marks since it was entered; [] for the others. */
  lines: StepperLine[];
  /** Why a locked phase is locked, in words; [] unless locked. */
  lockedBecause: string[];
}

export interface Stepper {
  current: number;
  last: number;
  phases: StepperPhase[];
  /** The current phase's exit lines not marked Met. */
  unmet: string[];
}

/**
 * The stepper as it stands: the moves oldest first, the marks oldest first. A mark counts only
 * when made since the episode entered the current phase (a phase entered again starts unmarked).
 */
export function phaseStepper(
  phases: readonly ProgrammePhase[],
  criteria: readonly PhaseCriterion[],
  marks: readonly PhaseMark[],
  moves: readonly PhaseMove[],
): Stepper {
  const ordered = [...phases].sort((a, b) => a.number - b.number);
  const last = ordered.at(-1)?.number ?? 0;
  const current = currentPhaseOf(moves);
  const since = moves.at(-1)?.movedAt.getTime() ?? Number.NEGATIVE_INFINITY;
  const latest = new Map<string, PhaseMarkResult>();
  for (const mark of marks) {
    if (mark.markedAt.getTime() >= since) latest.set(mark.criterionKey, mark.result);
  }
  const lines = criteria
    .filter((c) => c.phase === current)
    .sort((a, b) => a.position - b.position)
    .map((c): StepperLine => ({
      key: c.key,
      text: c.text,
      result: latest.get(c.key) ?? null,
      namesPainLimit: c.namesPainLimit,
    }));
  const unmet = lines.filter((line) => line.result !== 'met').map((line) => line.text);
  return {
    current,
    last,
    unmet,
    phases: ordered.map((phase): StepperPhase => {
      if (phase.number < current) {
        const passed = moves.some((m) => m.kind === 'progress' && m.fromPhase === phase.number);
        return { ...phase, state: passed ? 'done' : 'skipped', lines: [], lockedBecause: [] };
      }
      if (phase.number === current) return { ...phase, state: 'current', lines, lockedBecause: [] };
      const lockedBecause =
        phase.number === current + 1
          ? unmet.length > 0
            ? unmet.map((text) => `Phase ${String(current)}: ${text}`)
            : [`Every exit criterion of Phase ${String(current)} is Met: ready to move on.`]
          : [`Phase ${String(phase.number - 1)} comes first.`];
      return { ...phase, state: 'locked', lines: [], lockedBecause };
    }),
  };
}

/** Why the treating physio cannot move on now; null when every exit line is Met. */
export function progressRefusal(stepper: Stepper): string | null {
  if (stepper.current >= stepper.last) return 'This is the last phase.';
  if (stepper.unmet.length > 0) return 'Mark every exit criterion of this phase Met first.';
  return null;
}

/** The summary card's phase line ("Phase 2 of 4: Build Capacity"). */
export function phaseLine(stepper: Stepper): string {
  const phase = stepper.phases.find((p) => p.number === stepper.current);
  return `Phase ${String(stepper.current)} of ${String(stepper.last)}: ${phase?.name ?? ''}`;
}

/** The phase line for a region whose workbook has no phased programme (DECISION OUT-04). */
export const noPhasedProgramme = 'Phase: this workbook has no phased programme';

/**
 * The hint beside an exit line naming an acceptable pain (DECISION #4: the clinic's setting, a
 * placeholder until the client chooses 4/10 or 5/10): the newest signed session's pain during
 * activity against it. The physio still marks the line.
 */
export function painLimitHint(
  limit: number,
  latest: { value: number; session: number } | null,
): string {
  const setting = `Acceptable exercise pain is up to ${String(limit)}/10 (clinic setting).`;
  if (!latest) return `${setting} No session pain during activity recorded yet.`;
  return `${setting} Latest pain during activity: ${String(latest.value)}/10 at session ${String(latest.session)}.`;
}
