'use client';

import {
  PHASE_REASON_MAX,
  formatIstDateTime,
  phaseMarkResultLabels,
  phaseMarkResults,
  type PhaseMove,
  type StepperPhase,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import { useActionState } from 'react';
import { primaryButtonClass, secondaryButtonClass } from '../../../../../../components/forms';
import { Tag } from '../../../../../../components/tag';
import {
  markPhaseCriterionAction,
  overridePhaseAction,
  progressPhaseAction,
  type PhaseFormState,
} from '../../../../../../modules/phases/actions';
import type { PhasesView } from '../../../../../../modules/phases/phases';

const initialState: PhaseFormState = {};
const panelClass = 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-4';
const field =
  'h-row w-full min-w-0 rounded-control border border-line-control bg-surface px-3 text-md shadow-xs hover:border-ink-muted pointer-coarse:h-row-touch';
const textarea =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted';
const chip =
  'flex min-h-row flex-1 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-3 text-sm font-medium aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface disabled:cursor-default pointer-coarse:min-h-row-touch';
const disclosure =
  'cursor-pointer self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3';

const stateTag: Record<StepperPhase['state'], { tone: Tone; label: string }> = {
  done: { tone: 'done', label: 'Done' },
  skipped: { tone: 'outline', label: 'Skipped' },
  current: { tone: 'info', label: 'Current' },
  locked: { tone: 'outline', label: 'Locked' },
};

function Problem({ state }: { state: PhaseFormState }) {
  return state.error ? (
    <p role="alert" className="text-sm text-danger">
      {state.error}
    </p>
  ) : null;
}

interface Ids {
  episodeId: string;
  patientId: string;
}

function Hidden({ ids }: { ids: Ids }) {
  return (
    <>
      <input type="hidden" name="episodeId" value={ids.episodeId} />
      <input type="hidden" name="patientId" value={ids.patientId} />
    </>
  );
}

/** Met or Not yet on one exit criterion, one tap each. */
function MarkForm({ ids, line }: { ids: Ids; line: StepperPhase['lines'][number] }) {
  const [state, action, pending] = useActionState(markPhaseCriterionAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <Hidden ids={ids} />
      <input type="hidden" name="criterionKey" value={line.key} />
      <div className="flex flex-wrap gap-2" role="group" aria-label={line.text}>
        {phaseMarkResults.map((result) => (
          <button
            key={result}
            type="submit"
            name="result"
            value={result}
            disabled={pending}
            aria-pressed={line.result === result}
            className={chip}
          >
            {phaseMarkResultLabels[result]}
          </button>
        ))}
      </div>
      <Problem state={state} />
    </form>
  );
}

function ProgressForm({ ids, to, refusal }: { ids: Ids; to: number; refusal: string | null }) {
  const [state, action, pending] = useActionState(progressPhaseAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-1.5" data-testid="phase-progress">
      <Hidden ids={ids} />
      <input type="hidden" name="toPhase" value={to} />
      <button
        type="submit"
        disabled={pending || refusal !== null}
        className={`${primaryButtonClass} md:w-auto md:self-start`}
      >
        {pending ? 'Moving…' : `Move to Phase ${String(to)}`}
      </button>
      {refusal ? <p className="text-sm text-ink-muted">{refusal}</p> : null}
      <Problem state={state} />
    </form>
  );
}

function OverrideForm({ ids, phases }: { ids: Ids; phases: StepperPhase[] }) {
  const [state, action, pending] = useActionState(overridePhaseAction, initialState);
  return (
    <details className="flex flex-col gap-2" data-testid="phase-override">
      <summary className={disclosure}>Move to another phase (consultant override)</summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <Hidden ids={ids} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-secondary">Phase</span>
          <select name="toPhase" required defaultValue="" className={field}>
            <option value="" disabled>
              Choose the phase
            </option>
            {phases
              .filter((phase) => phase.state !== 'current')
              .map((phase) => (
                <option key={phase.number} value={phase.number}>
                  Phase {phase.number}: {phase.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-secondary">Reason</span>
          <textarea
            name="reason"
            rows={2}
            required
            maxLength={PHASE_REASON_MAX}
            className={textarea}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={`${secondaryButtonClass} md:w-auto md:self-start`}
        >
          {pending ? 'Moving…' : 'Move phase'}
        </button>
        <Problem state={state} />
      </form>
    </details>
  );
}

function History({ moves }: { moves: PhaseMove[] }) {
  if (moves.length === 0) return null;
  return (
    <details className="flex flex-col gap-2" data-testid="phase-history">
      <summary className={disclosure}>Phase history</summary>
      <ul className="mt-2 flex flex-col gap-2 text-sm text-ink-secondary">
        {moves.map((move) => (
          <li key={move.movedAt.toISOString()}>
            {move.kind === 'progress'
              ? `Moved on from Phase ${String(move.fromPhase)} to Phase ${String(move.toPhase)}`
              : `Override from Phase ${String(move.fromPhase)} to Phase ${String(move.toPhase)}: ${move.reason ?? ''}`}{' '}
            · {move.movedByName} · {formatIstDateTime(move.movedAt)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Step({ phase, view, ids }: { phase: StepperPhase; view: PhasesView; ids: Ids }) {
  const tag = stateTag[phase.state];
  return (
    <li
      className="flex gap-3"
      data-testid="phase-step"
      data-phase={phase.number}
      data-state={phase.state}
    >
      <span
        aria-hidden="true"
        className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
          phase.state === 'current'
            ? 'border-ink bg-ink text-surface'
            : phase.state === 'done'
              ? 'border-ink text-ink'
              : 'border-line-control text-ink-muted'
        }`}
      >
        {phase.number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pb-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">
            Phase {phase.number}: {phase.name}
          </span>
          <Tag tone={tag.tone}>{tag.label}</Tag>
        </span>
        {phase.timing ? <span className="text-sm text-ink-muted">{phase.timing}</span> : null}
        {phase.state === 'current' ? (
          <>
            <p className="text-sm text-ink-secondary">{phase.goal}</p>
            <h3 className="text-sm font-semibold text-ink">Exit criteria</h3>
            <ul className="flex flex-col gap-3">
              {phase.lines.map((line) => (
                <li
                  key={line.key}
                  className="flex flex-col gap-1.5"
                  data-testid="phase-line"
                  data-key={line.key}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-ink">{line.text}</span>
                    <Tag tone={line.result === 'met' ? 'done' : 'waiting'}>
                      {line.result ? phaseMarkResultLabels[line.result] : 'Not marked'}
                    </Tag>
                  </span>
                  {line.namesPainLimit ? (
                    <span className="text-sm text-ink-muted" data-testid="phase-pain-hint">
                      {view.painHint}
                    </span>
                  ) : null}
                  {view.marks ? <MarkForm ids={ids} line={line} /> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {phase.state === 'locked' ? (
          <div className="flex flex-col gap-1 text-sm" data-testid="phase-locked">
            <span className="text-ink-secondary">Unlocks when:</span>
            <ul className="list-disc pl-5 text-ink-muted">
              {phase.lockedBecause.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The phase stepper (OUT-04, Frontend Specification "Phase stepper"): the programme's phases in
 * order, the current one with its exit criteria, locked ones with what is unmet in words. The
 * treating physio marks and moves on; a consultant overrides with a reason.
 */
export function PhaseStepper({ view, ids }: { view: PhasesView; ids: Ids }) {
  const { stepper } = view;
  return (
    <section aria-labelledby="progress-phases" className={panelClass} data-testid="phase-stepper">
      <h2 id="progress-phases" className="font-semibold text-ink">
        Phases
      </h2>
      {!stepper ? (
        <p className="text-ink-muted">{view.missing}</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {stepper.phases.map((phase) => (
              <Step key={phase.number} phase={phase} view={view} ids={ids} />
            ))}
          </ol>
          {view.marks && stepper.current < stepper.last ? (
            <ProgressForm ids={ids} to={stepper.current + 1} refusal={view.refusal} />
          ) : null}
          {view.overrides ? <OverrideForm ids={ids} phases={stepper.phases} /> : null}
          <History moves={view.history} />
        </>
      )}
    </section>
  );
}
