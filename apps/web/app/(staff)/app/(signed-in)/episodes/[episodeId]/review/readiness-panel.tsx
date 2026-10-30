'use client';

import {
  OVERRIDE_REASON_MAX,
  clearanceSectionFields,
  clearanceSectionHints,
  clearanceSectionTitles,
  clearanceSections,
  criterionResultLabels,
  criterionResults,
  formatIstDateTime,
  takesBothSides,
  type CriterionResult,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import { useActionState } from 'react';
import { primaryButtonClass, secondaryButtonClass } from '../../../../../../../components/forms';
import { PatientLinkQr } from '../../../../../../../components/patient-link-qr';
import { Tag } from '../../../../../../../components/tag';
import { showClearanceAcknowledgementAction } from '../../../../../../../modules/consent/actions';
import {
  markReadinessCheckAction,
  overrideReadinessAction,
  recordReadinessReadingAction,
  signClearanceAction,
  type ReadinessFormState,
} from '../../../../../../../modules/reviews/actions';
import type {
  ReadinessClearance,
  ReadinessRow,
  ReadinessView,
} from '../../../../../../../modules/reviews/readiness';

const initialState: ReadinessFormState = {};
const field =
  'h-row w-full min-w-0 rounded-control border border-line-control bg-surface px-3 text-md shadow-xs hover:border-ink-muted pointer-coarse:h-row-touch';
const textarea =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted';
const chip =
  'flex min-h-row flex-1 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-3 text-sm font-medium aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface disabled:cursor-default pointer-coarse:min-h-row-touch';
const disclosure =
  'cursor-pointer self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3';

type State = CriterionResult | 'overridden';
const stateTone: Record<State, Tone> = {
  met: 'done',
  not_met: 'danger',
  not_assessed: 'waiting',
  overridden: 'info',
};
const stateLabel = (state: State) =>
  state === 'overridden' ? 'Overridden' : criterionResultLabels[state];
const stateOf = (row: ReadinessRow): State =>
  row.result !== 'met' && row.override ? 'overridden' : row.result;

function Problem({ state }: { state: ReadinessFormState }) {
  return state.error ? (
    <p role="alert" className="text-sm text-danger">
      {state.error}
    </p>
  ) : null;
}

/** Met, Not met or Not assessed for a yes or no criterion, one tap each. */
function CheckForm({ episodeId, row }: { episodeId: string; row: ReadinessRow }) {
  const [state, action, pending] = useActionState(markReadinessCheckAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="episodeId" value={episodeId} />
      <input type="hidden" name="criterionKey" value={row.criterion.key} />
      <div className="flex flex-wrap gap-2" role="group" aria-label={row.criterion.text}>
        {criterionResults.map((result) => (
          <button
            key={result}
            type="submit"
            name="result"
            value={result}
            disabled={pending}
            aria-pressed={row.result === result}
            className={chip}
          >
            {criterionResultLabels[result]}
          </button>
        ))}
      </div>
      <Problem state={state} />
    </form>
  );
}

/** A reading for a measured criterion never measured in the episode. */
function ReadingForm({ episodeId, row }: { episodeId: string; row: ReadinessRow }) {
  const [state, action, pending] = useActionState(recordReadinessReadingAction, initialState);
  const measure = row.measure;
  if (!measure) return null;
  const unit = measure.unit === 'grade' ? '' : measure.unit;
  const number = (name: string, label: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-ink-secondary">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          name={name}
          aria-label={`${measure.name} ${label.toLowerCase()}`}
          className={`${field} max-w-32`}
        />
        <span className="text-ink-secondary">{unit}</span>
      </span>
    </label>
  );
  return (
    <details className="flex flex-col gap-2">
      <summary className={disclosure}>Record a reading</summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="episodeId" value={episodeId} />
        <input type="hidden" name="criterionKey" value={row.criterion.key} />
        {takesBothSides(measure) ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {number('involved', 'Involved')}
            {number('uninvolved', 'Uninvolved')}
          </div>
        ) : (
          number('value', 'Value')
        )}
        <button
          type="submit"
          disabled={pending}
          className={`${secondaryButtonClass} md:w-auto md:self-start`}
        >
          {pending ? 'Saving…' : 'Save reading'}
        </button>
        <Problem state={state} />
      </form>
    </details>
  );
}

/** The written reason that lets a criterion not Met stop blocking the clearances. */
function OverrideForm({ episodeId, row }: { episodeId: string; row: ReadinessRow }) {
  const [state, action, pending] = useActionState(overrideReadinessAction, initialState);
  return (
    <details className="flex flex-col gap-2">
      <summary className={disclosure}>{row.override ? 'Change the override' : 'Override'}</summary>
      <form action={action} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="episodeId" value={episodeId} />
        <input type="hidden" name="criterionKey" value={row.criterion.key} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-secondary">Reason for the override</span>
          <textarea
            name="reason"
            rows={2}
            required
            maxLength={OVERRIDE_REASON_MAX}
            aria-label={`Reason to override ${row.criterion.text}`}
            className={textarea}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={`${secondaryButtonClass} md:w-auto md:self-start`}
        >
          {pending ? 'Saving…' : 'Save override'}
        </button>
        <Problem state={state} />
      </form>
    </details>
  );
}

function CriterionRow({
  episodeId,
  row,
  works,
}: {
  episodeId: string;
  row: ReadinessRow;
  works: boolean;
}) {
  const state = stateOf(row);
  return (
    <li
      data-testid="readiness-row"
      data-criterion={row.criterion.key}
      className="flex flex-col gap-1.5 border-t border-line pt-3 first:border-0 first:pt-0"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink">{row.criterion.text}</span>
        <span data-testid="readiness-state" className="shrink-0">
          <Tag tone={stateTone[state]}>{stateLabel(state)}</Tag>
        </span>
      </span>
      {row.measure ? (
        <p className="text-sm text-ink-secondary">
          {row.reading
            ? `${row.reading} (${row.readingFrom ?? ''})`
            : 'Not measured in this episode.'}
        </p>
      ) : row.criterion.rule.kind === 'none_positive' ? (
        <p className="text-sm text-ink-secondary">Met when none is positive.</p>
      ) : null}
      {row.criterion.fromVerdict ? (
        <p className="text-sm text-ink-muted">From the overall verdict: {row.criterion.section}</p>
      ) : null}
      {row.check ? (
        <p className="text-sm text-ink-muted">
          Marked {criterionResultLabels[row.check.result]} by {row.check.by},{' '}
          {formatIstDateTime(row.check.at)}.
        </p>
      ) : null}
      {row.override && row.result !== 'met' ? (
        <p className="text-sm text-ink" data-testid="readiness-override">
          Override by {row.override.by}: {row.override.reason}
        </p>
      ) : null}
      {works ? (
        <>
          {row.criterion.kind === 'check' ? <CheckForm episodeId={episodeId} row={row} /> : null}
          {row.measure && !row.reading ? <ReadingForm episodeId={episodeId} row={row} /> : null}
          {row.result !== 'met' ? (
            // A saved override starts a fresh, closed form.
            <OverrideForm
              key={row.override?.at.toISOString() ?? 'none'}
              episodeId={episodeId}
              row={row}
            />
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/** The three sections a consultant writes for the patient (OUT-09), on the signing form. */
function ClearanceTexts() {
  return (
    <fieldset className="flex flex-col gap-3" data-testid="clearance-texts">
      <legend className="mb-1 text-sm text-ink-secondary">
        For the patient to read and acknowledge on their phone.
      </legend>
      {clearanceSections.map((section) => {
        const name = clearanceSectionFields[section];
        const id = ['clearance', section].join('-');
        return (
          <div key={section} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium text-ink">
              {clearanceSectionTitles[section]}
            </label>
            <p id={`${id}-hint`} className="text-sm text-ink-muted">
              {clearanceSectionHints[section]}
            </p>
            <textarea
              id={id}
              name={name}
              required
              maxLength={2000}
              rows={3}
              aria-describedby={`${id}-hint`}
              className={textarea}
            />
          </div>
        );
      })}
    </fieldset>
  );
}

/** Where the patient's acknowledgement stands (OUT-09), and the QR that asks for it. */
function Acknowledgement({
  episodeId,
  acknowledgement,
  showsQr,
  origin,
}: {
  episodeId: string;
  acknowledgement: NonNullable<ReadinessClearance['acknowledgement']>;
  showsQr: boolean;
  origin: string;
}) {
  if (acknowledgement.at) {
    return (
      <p className="text-sm text-ink-secondary" data-testid="clearance-acknowledged">
        Acknowledged by the {acknowledgement.byGuardian ? 'patient’s guardian' : 'patient'} on{' '}
        {formatIstDateTime(acknowledgement.at)}.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="clearance-acknowledgement">
      <p className="text-sm text-waiting-strong">Not acknowledged by the patient yet.</p>
      {showsQr && acknowledgement.next ? (
        <PatientLinkQr
          id="clearance"
          title="Clearance acknowledgement for the patient"
          description="The plan, the warning signs to stop and the residual risk you wrote. The patient ticks each and signs. They scan it with their phone camera."
          buttonLabel="Show clearance QR"
          alt="QR code for the patient’s clearance acknowledgement"
          action={showClearanceAcknowledgementAction}
          fields={{ episodeId }}
          origin={origin}
        />
      ) : null}
    </div>
  );
}

function ClearanceRow({
  episodeId,
  clearance,
  works,
  showsQr,
  origin,
}: {
  episodeId: string;
  clearance: ReadinessClearance;
  works: boolean;
  showsQr: boolean;
  origin: string;
}) {
  const [state, action, pending] = useActionState(signClearanceAction, initialState);
  return (
    <li
      data-testid="clearance"
      data-status={clearance.status}
      className="flex flex-col gap-1.5 border-t border-line pt-3 first:border-0 first:pt-0"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink">{clearance.label}</span>
        <Tag tone={clearance.signed ? 'done' : 'waiting'}>
          {clearance.signed ? 'Signed' : 'Not signed'}
        </Tag>
      </span>
      {clearance.signed ? (
        <>
          <p className="text-sm text-ink-secondary">
            Signed by {clearance.signed.by} on {formatIstDateTime(clearance.signed.at)}.
          </p>
          {clearance.acknowledgement ? (
            <Acknowledgement
              episodeId={episodeId}
              acknowledgement={clearance.acknowledgement}
              showsQr={showsQr}
              origin={origin}
            />
          ) : null}
        </>
      ) : (
        <>
          {clearance.refusal ? (
            <p className="text-sm text-waiting-strong" data-testid="clearance-blocked">
              {clearance.refusal}
            </p>
          ) : null}
          {works ? (
            <form action={action} className="flex flex-col gap-1.5">
              <input type="hidden" name="episodeId" value={episodeId} />
              <input type="hidden" name="status" value={clearance.status} />
              {clearance.asksTexts && clearance.refusal === undefined ? <ClearanceTexts /> : null}
              <button
                type="submit"
                disabled={pending || clearance.refusal !== undefined}
                className={`${primaryButtonClass} md:w-auto md:self-start`}
              >
                {pending ? 'Signing…' : `Sign ${clearance.label}`}
              </button>
              <Problem state={state} />
            </form>
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * The readiness panel and the three clearances (OUT-08, Frontend Specification "Readiness
 * panel"): each criterion with Met, Not met, Not assessed or Overridden, grouped by the workbook's
 * sections; a consultant marks, records, overrides with a reason and signs in order. Built for
 * 360 px: every row stacks.
 */
export function ReadinessPanel({
  episodeId,
  view,
  works,
  showsClearanceQr,
  origin,
}: {
  episodeId: string;
  view: ReadinessView;
  works: boolean;
  /** A consultant with the Treats patients tick shows the clearance QR (OUT-09). */
  showsClearanceQr: boolean;
  origin: string;
}) {
  const sections = [...new Set(view.rows.map((row) => row.criterion.section))];
  return (
    <>
      <section
        aria-labelledby="readiness"
        className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
        data-testid="readiness"
      >
        <h2 id="readiness" className="font-semibold text-ink">
          Readiness
        </h2>
        {sections.map((section) => (
          <div key={section} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-ink-secondary">{section}</h3>
            <ul className="flex flex-col gap-3">
              {view.rows
                .filter((row) => row.criterion.section === section)
                .map((row) => (
                  <CriterionRow
                    key={row.criterion.key}
                    episodeId={episodeId}
                    row={row}
                    works={works}
                  />
                ))}
            </ul>
          </div>
        ))}
      </section>
      <section
        aria-labelledby="clearances"
        className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
        data-testid="clearances"
      >
        <h2 id="clearances" className="font-semibold text-ink">
          Clearance
        </h2>
        <ul className="flex flex-col gap-3">
          {view.clearances.map((clearance) => (
            <ClearanceRow
              key={clearance.status}
              episodeId={episodeId}
              clearance={clearance}
              works={works}
              showsQr={showsClearanceQr}
              origin={origin}
            />
          ))}
        </ul>
      </section>
    </>
  );
}
