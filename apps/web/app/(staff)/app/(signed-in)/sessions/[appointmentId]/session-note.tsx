'use client';

import {
  BASELINE_REASON_MAX,
  formatIstDate,
  formatIstDateTime,
  interventionLabels,
  istDate,
  nextSessionPlanLabels,
  nextSessionPlans,
  painReadingLabels,
  painReadings,
  sameAsLastTime,
  sameAsLastTimeOverwrites,
  sessionNoteBlockers,
  sessionNoteSchema,
  sessionResponseLabels,
  sessionResponses,
  type BaselineEntry,
  type InterventionKind,
  type ReassessmentEntry,
  type SessionModality,
  type SessionNote,
} from '@clinic-mx/schemas';
import { startTransition, useActionState, useMemo, useState, type ReactNode } from 'react';
import { primaryButtonClass, secondaryButtonClass } from '../../../../../../components/forms';
import { PainSlider } from '../../../../../../components/pain-slider';
import { Choices, RetestInputs } from '../../../../../../components/retest-inputs';
import { ConflictNotice } from '../../../../../../lib/drafts/conflict-notice';
import { SaveStatus } from '../../../../../../lib/drafts/save-status';
import { saveSessionNoteDraft } from '../../../../../../lib/drafts/savers';
import { useAutosave } from '../../../../../../lib/drafts/use-autosave';
import {
  closeSessionAction,
  type CloseSessionState,
} from '../../../../../../modules/sessions/actions';
import type { BaselineItem, BaselineView } from '../../../../../../modules/sessions/baseline';
import type {
  ReassessedItem,
  ReassessmentView,
} from '../../../../../../modules/sessions/reassessment';
import { ReassessmentRows } from '../../reassessments/[reassessmentId]/reassessment-rows';

const textarea =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken';
const tick = 'size-5 shrink-0 accent-ink';
const panel = 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-4';

const initialState: CloseSessionState = {};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className={panel}>
      <legend className="sr-only">{title}</legend>
      <h3 aria-hidden="true" className="font-semibold text-ink">
        {title}
      </h3>
      {children}
    </fieldset>
  );
}

function Note({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-secondary">{label}</span>
      <textarea
        rows={2}
        maxLength={2000}
        readOnly={readOnly}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={textarea}
      />
    </label>
  );
}

const input =
  'h-row w-full min-w-0 rounded-control border border-line-control bg-surface px-3 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken pointer-coarse:h-row-touch';
const grades = ['0', '1', '2', '3'] as const;
const gradeLabels = { 0: '0', 1: '1', 2: '2', 3: '3' } as Record<(typeof grades)[number], string>;
const emptyEntry: BaselineEntry = { value: null, notTested: false, reason: '' };

/** Where a baseline reading came from, as the section words it. */
function baselineSource(item: BaselineItem, readOnly: boolean): string {
  const taken = item.takenAt ? formatIstDate(istDate(item.takenAt)) : '';
  switch (item.source) {
    case 'consultation':
      return `Consultation, ${taken}`;
    case 'session':
      return 'Session 1';
    case 'not_tested':
      return 'Not tested';
    case 'requested':
      return readOnly ? 'Not recorded yet' : 'Record today';
  }
}

/**
 * Session 1's baseline (OUT-01, PRD J5.3): what the consultation measured within the setting's
 * days is reused as it is; each of the region's markers without a reading is recorded here, or
 * marked Not tested with a reason. Signing freezes it.
 */
function BaselineSection({
  baseline,
  entries,
  readOnly,
  onChange,
}: {
  baseline: BaselineView;
  entries: SessionNote['baseline'];
  readOnly: boolean;
  onChange: (key: string, entry: BaselineEntry) => void;
}) {
  return (
    <Section title="Baseline">
      <p className="text-sm text-ink-secondary">
        Consultation measures from the {baseline.reuseDays} days before this session count.
        {readOnly ? '' : ' Record each marker still missing, or mark it Not tested.'}
      </p>
      {baseline.items.length === 0 ? (
        <p className="text-ink-muted">No measures or markers for this episode&apos;s region.</p>
      ) : null}
      <ul className="flex flex-col gap-3" data-testid="baseline">
        {baseline.items.map((item) => {
          const entry = entries[item.key] ?? emptyEntry;
          const asked = item.source === 'requested';
          const id = ['baseline', item.key].join('-');
          return (
            <li
              key={item.key}
              data-testid="baseline-item"
              data-source={item.source}
              className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="font-medium text-ink">{item.name}</span>
                <span className="text-sm text-ink-muted">{baselineSource(item, readOnly)}</span>
              </div>
              {item.reading ? <p className="text-ink">{item.reading}</p> : null}
              {item.reason ? <p className="text-ink-secondary">{item.reason}</p> : null}
              {asked ? (
                <div className="flex flex-col gap-2">
                  {!entry.notTested ? (
                    item.kind === 'grade' ? (
                      <Choices
                        name={id}
                        options={grades}
                        labels={gradeLabels}
                        value={
                          entry.value === null
                            ? null
                            : (String(entry.value) as (typeof grades)[number])
                        }
                        readOnly={readOnly}
                        onChange={(value) => {
                          onChange(item.key, { ...entry, value: Number(value) });
                        }}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          id={id}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          aria-label={item.name}
                          readOnly={readOnly}
                          value={entry.value ?? ''}
                          onChange={(event) => {
                            const value = event.target.valueAsNumber;
                            onChange(item.key, {
                              ...entry,
                              value: Number.isFinite(value) ? value : null,
                            });
                          }}
                          className={`${input} max-w-40`}
                        />
                        <span className="text-ink-secondary">{item.unit}</span>
                      </div>
                    )
                  ) : null}
                  {item.direction ? (
                    <p className="text-sm text-ink-muted">{item.direction}</p>
                  ) : null}
                  <label className="flex min-h-row items-center gap-3 pointer-coarse:min-h-row-touch">
                    <input
                      type="checkbox"
                      className={tick}
                      disabled={readOnly}
                      checked={entry.notTested}
                      onChange={(event) => {
                        onChange(item.key, { ...entry, notTested: event.target.checked });
                      }}
                    />
                    Not tested
                  </label>
                  {entry.notTested ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-ink-secondary">
                        Why it was not tested
                      </span>
                      <input
                        type="text"
                        maxLength={BASELINE_REASON_MAX}
                        readOnly={readOnly}
                        value={entry.reason}
                        onChange={(event) => {
                          onChange(item.key, { ...entry, reason: event.target.value });
                        }}
                        className={input}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * The reassessment session (OUT-05, PRD J5.10): each measure the baseline holds, its baseline
 * reading, and this session's (both sides of a side by side measure), with the change as it is
 * typed; or Not tested with a reason. Once signed, baseline against this session and the
 * consultant's review.
 */
function ReassessmentSection({
  view,
  entries,
  readOnly,
  signed,
  onChange,
}: {
  view: ReassessmentView;
  entries: SessionNote['reassessment'];
  readOnly: boolean;
  signed: boolean;
  onChange: (key: string, entry: ReassessmentEntry) => void;
}) {
  const title = `Reassessment (session ${String(view.sessionNumber)})`;
  if (signed && view.rows) {
    return (
      <Section title={title}>
        <ReassessmentRows rows={view.rows} sessionNumber={view.sessionNumber} />
        <p className="text-sm text-ink-secondary" data-testid="reassessment-review">
          {view.decision
            ? `Reviewed by ${view.decision.by} on ${formatIstDateTime(view.decision.at)}.`
            : `Awaiting ${view.consultantName ?? 'the consultant'}'s review.`}
        </p>
        {view.reassessmentId ? (
          <a
            href={`/app/reassessments/${view.reassessmentId}`}
            className="self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3"
          >
            Open the review
          </a>
        ) : null}
      </Section>
    );
  }
  return (
    <Section title={title}>
      <p className="text-sm text-ink-secondary">
        {readOnly
          ? 'The baseline measures, taken again for the consultant to review.'
          : 'Take each baseline measure again, or mark it Not tested. The consultant reviews them.'}
      </p>
      {view.items.length === 0 ? (
        <p className="text-ink-muted">
          No baseline was recorded at session 1, so there is nothing to reassess.
        </p>
      ) : null}
      <ul className="flex flex-col gap-3" data-testid="reassessment">
        {view.items.map((item: ReassessedItem) => {
          const { measure } = item;
          return (
            <li
              key={measure.key}
              data-testid="reassessment-item"
              className="flex flex-col gap-2 border-t border-line pt-3 first:border-0 first:pt-0"
            >
              <span className="font-medium text-ink">{measure.name}</span>
              <p className="text-sm text-ink-secondary">
                Baseline:{' '}
                {item.baseline ??
                  `Not tested${item.baselineNotTested ? ` (${item.baselineNotTested})` : ''}`}
              </p>
              <RetestInputs
                measure={measure}
                baselineEntry={item.baselineEntry}
                entry={entries[measure.key]}
                readOnly={readOnly}
                testIdPrefix="reassessment"
                onChange={(entry) => {
                  onChange(measure.key, entry);
                }}
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * The session note (SES-03, PRD J5.4; user decisions 26 October 2026): new symptoms first, then
 * since last visit, the three pain sliders, the treatment given as ticks from the plan, the
 * response, home programme changes and the next session; autosaved as it is written. Session 1
 * also records the baseline (OUT-01) after the pain readings, and the reassessment session takes
 * it again (OUT-05). Close session saves what is left and
 * signs it at that version.
 */
export function SessionNoteForm({
  appointmentId,
  serverValue,
  serverVersion,
  editable,
  signed,
  plan,
  lastTime,
  modalityDefinitions,
  baseline,
  reassessment,
}: {
  appointmentId: string;
  serverValue: SessionNote;
  serverVersion: number;
  editable: boolean;
  signed: { by: string; at: Date } | null;
  plan: {
    interventions: InterventionKind[];
    modalities: { key: string; name: string }[];
    homeProgramme: { exercise: string; dose: string; note: string }[];
  };
  /** The episode's previous signed note, for "Same as last time" (SES-04). */
  lastTime: { number: number; signedAt: Date; note: SessionNote } | null;
  /** The modalities at the note's version: parameters and precaution warnings (SES-05). */
  modalityDefinitions: SessionModality[];
  /** Session 1's baseline (OUT-01); null for any other session. */
  baseline: BaselineView | null;
  /** The reassessment session's section (OUT-05); null for any other session. */
  reassessment: ReassessmentView | null;
}) {
  const save = useMemo(() => saveSessionNoteDraft(appointmentId), [appointmentId]);
  const draft = useAutosave({
    kind: 'session',
    id: appointmentId,
    serverValue,
    serverVersion,
    save,
  });
  const note = useMemo(() => {
    const read = sessionNoteSchema.safeParse(draft.value);
    return read.success ? read.data : serverValue;
  }, [draft.value, serverValue]);
  const readOnly = !editable;
  const set = (change: Partial<SessionNote>) => {
    draft.setValue({ ...note, ...change });
  };
  // A signed note's baseline is frozen; only a draft asks for markers.
  const requested = signed
    ? []
    : (baseline?.items.filter((item) => item.source === 'requested') ?? []);
  const reassessed = signed ? [] : (reassessment?.items.map((item) => item.measure) ?? []);
  const blockers = sessionNoteBlockers(note, modalityDefinitions, requested, reassessed);
  const definitionOf = (key: string) => modalityDefinitions.find((m) => m.key === key);
  const [state, action, pending] = useActionState(closeSessionAction, initialState);
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  // SES-04: asks first when it would replace what the physio entered.
  const [confirmingCopy, setConfirmingCopy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyLastTime = () => {
    if (!lastTime) return;
    set(sameAsLastTime(note, lastTime.note));
    setConfirmingCopy(false);
    setCopied(true);
  };

  // The ticks: the plan's, and any the note carries from last time.
  const interventions = [
    ...new Set([...plan.interventions, ...note.treatment.interventions]),
  ] as InterventionKind[];
  const modalities = [
    ...plan.modalities,
    ...note.treatment.modalities
      .filter((key) => !plan.modalities.some((modality) => modality.key === key))
      .map((key) => ({ key, name: definitionOf(key)?.name ?? key })),
  ];
  const toggle = <T extends string>(list: readonly T[], item: T, on: boolean) =>
    on ? [...list, item] : list.filter((entry) => entry !== item);

  const close = async () => {
    setSaving(true);
    setUnsaved(false);
    const version = await draft.saveNow();
    setSaving(false);
    if (version === undefined) {
      setUnsaved(true);
      return;
    }
    const form = new FormData();
    form.set('appointmentId', appointmentId);
    form.set('baseVersion', String(version));
    startTransition(() => {
      action(form);
    });
  };

  return (
    <section
      aria-labelledby="session-note"
      className={`flex flex-col gap-4 ${editable ? 'pb-24 md:pb-0' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="session-note" className="text-lg font-semibold">
          Session note
        </h2>
        {editable ? <SaveStatus status={draft.status} /> : null}
      </div>
      {signed ? (
        <p
          data-testid="session-signed"
          className="rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm"
        >
          Signed by {signed.by} on {formatIstDateTime(signed.at)}.
        </p>
      ) : null}
      {draft.status === 'conflict' ? (
        <ConflictNotice keepMine={draft.keepMine} takeSaved={draft.takeSaved} />
      ) : null}
      {editable && lastTime ? (
        <div className="flex flex-col gap-2" data-testid="same-as-last-time">
          <button
            type="button"
            onClick={() => {
              if (sameAsLastTimeOverwrites(note, lastTime.note)) setConfirmingCopy(true);
              else copyLastTime();
            }}
            className={`${secondaryButtonClass} md:w-auto md:self-start`}
          >
            Same as last time (session {lastTime.number},{' '}
            {formatIstDate(istDate(lastTime.signedAt))})
          </button>
          {confirmingCopy ? (
            <div className={panel} role="group" aria-label="Replace with last time">
              <p className="font-medium text-ink">
                Replace what you have entered with last time&apos;s note?
              </p>
              <p className="text-sm text-ink-secondary">
                Treatment, home programme changes and next session are replaced.
              </p>
              <div className="flex flex-col gap-2 md:flex-row">
                <button
                  type="button"
                  onClick={copyLastTime}
                  className={`${primaryButtonClass} md:w-auto`}
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingCopy(false);
                  }}
                  className={`${secondaryButtonClass} md:w-auto`}
                >
                  Keep mine
                </button>
              </div>
            </div>
          ) : null}
          {copied ? (
            <p aria-live="polite" className="text-sm text-ink-secondary">
              Copied from session {lastTime.number}. Check it before closing.
            </p>
          ) : null}
        </div>
      ) : null}

      <Section title="Any new symptoms?">
        <Choices
          name="new-symptoms"
          options={['no', 'yes'] as const}
          labels={{ no: 'No', yes: 'Yes' }}
          value={note.newSymptoms.answer}
          readOnly={readOnly}
          onChange={(answer) => {
            set({ newSymptoms: { ...note.newSymptoms, answer } });
          }}
        />
        {note.newSymptoms.answer === 'yes' ? (
          <>
            <Note
              label="Describe the new symptoms"
              value={note.newSymptoms.description}
              readOnly={readOnly}
              onChange={(description) => {
                set({ newSymptoms: { ...note.newSymptoms, description } });
              }}
            />
            {editable ? (
              <p className="text-sm text-waiting-strong">
                Closing the session gives the consultant a task to review them.
              </p>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="Since last visit">
        <Note
          label="What the patient reports"
          value={note.sinceLastVisit}
          readOnly={readOnly}
          onChange={(sinceLastVisit) => {
            set({ sinceLastVisit });
          }}
        />
      </Section>

      <Section title="Pain">
        {painReadings.map((reading) => (
          <PainSlider
            key={reading}
            label={painReadingLabels[reading]}
            value={note.pain[reading]}
            readOnly={readOnly}
            onChange={(value) => {
              set({ pain: { ...note.pain, [reading]: value } });
            }}
          />
        ))}
      </Section>

      {baseline ? (
        <BaselineSection
          baseline={baseline}
          entries={note.baseline}
          readOnly={readOnly}
          onChange={(key, entry) => {
            set({ baseline: { ...note.baseline, [key]: entry } });
          }}
        />
      ) : null}

      {reassessment ? (
        <ReassessmentSection
          view={reassessment}
          entries={note.reassessment}
          readOnly={readOnly}
          signed={signed !== null}
          onChange={(key, entry) => {
            set({ reassessment: { ...note.reassessment, [key]: entry } });
          }}
        />
      ) : null}

      <Section title="Treatment given">
        <div className="flex flex-col gap-2" data-testid="treatment-ticks">
          {interventions.map((kind) => (
            <label
              key={kind}
              className="flex min-h-row items-center gap-3 pointer-coarse:min-h-row-touch"
            >
              <input
                type="checkbox"
                className={tick}
                disabled={readOnly}
                checked={note.treatment.interventions.includes(kind)}
                onChange={(event) => {
                  set({
                    treatment: {
                      ...note.treatment,
                      interventions: toggle(
                        note.treatment.interventions,
                        kind,
                        event.target.checked,
                      ),
                    },
                  });
                }}
              />
              {interventionLabels[kind]}
            </label>
          ))}
          {modalities.map((modality) => {
            const ticked = note.treatment.modalities.includes(modality.key);
            const definition = definitionOf(modality.key);
            const values = note.treatment.parameters[modality.key] ?? {};
            return (
              <div key={modality.key} className="flex flex-col gap-2">
                <label className="flex min-h-row items-center gap-3 pointer-coarse:min-h-row-touch">
                  <input
                    type="checkbox"
                    className={tick}
                    disabled={readOnly}
                    checked={ticked}
                    onChange={(event) => {
                      set({
                        treatment: {
                          ...note.treatment,
                          modalities: toggle(
                            note.treatment.modalities,
                            modality.key,
                            event.target.checked,
                          ),
                        },
                      });
                    }}
                  />
                  {modality.name}
                </label>
                {ticked && definition ? (
                  // SES-05: its parameters, and a reason when it warns about a precaution.
                  <div
                    data-testid="modality-parameters"
                    data-modality={modality.key}
                    className="ml-8 flex flex-col gap-3 border-l-2 border-line pl-3"
                  >
                    {definition.warnings.length > 0 ? (
                      <div className="flex flex-col gap-2 rounded-control border border-waiting-line bg-waiting-soft px-3 py-2">
                        {definition.warnings.map((warning) => (
                          <p key={warning.label} className="text-sm text-waiting-strong">
                            Precaution: {warning.label} ({warning.source})
                          </p>
                        ))}
                        <Note
                          label="Reason it is still given today"
                          value={note.treatment.reasons[modality.key] ?? ''}
                          readOnly={readOnly}
                          onChange={(reason) => {
                            set({
                              treatment: {
                                ...note.treatment,
                                reasons: { ...note.treatment.reasons, [modality.key]: reason },
                              },
                            });
                          }}
                        />
                      </div>
                    ) : null}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {definition.parameters.map((field) => {
                        const id = `${modality.key}-${field.key}`;
                        return (
                          <div key={field.key} className="flex flex-col gap-1.5">
                            <label htmlFor={id} className="text-sm font-medium text-ink">
                              {field.label}
                              {field.unit ? (
                                <span className="font-normal text-ink-muted"> ({field.unit})</span>
                              ) : null}
                            </label>
                            <input
                              id={id}
                              type="text"
                              inputMode={field.kind === 'number' ? 'decimal' : 'text'}
                              maxLength={200}
                              readOnly={readOnly}
                              value={values[field.key] ?? ''}
                              onChange={(event) => {
                                set({
                                  treatment: {
                                    ...note.treatment,
                                    parameters: {
                                      ...note.treatment.parameters,
                                      [modality.key]: {
                                        ...values,
                                        [field.key]: event.target.value,
                                      },
                                    },
                                  },
                                });
                              }}
                              className="h-row w-full min-w-0 rounded-control border border-line-control bg-surface px-3 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken pointer-coarse:h-row-touch"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {interventions.length + modalities.length === 0 ? (
            <p className="text-ink-muted">The plan names no treatment yet.</p>
          ) : null}
        </div>
        <Note
          label="Treatment note"
          value={note.treatment.note}
          readOnly={readOnly}
          onChange={(value) => {
            set({ treatment: { ...note.treatment, note: value } });
          }}
        />
      </Section>

      <Section title="Response">
        <Choices
          name="response"
          options={sessionResponses}
          labels={sessionResponseLabels}
          value={note.response.rating}
          readOnly={readOnly}
          onChange={(rating) => {
            set({ response: { ...note.response, rating } });
          }}
        />
        <Note
          label="Response note"
          value={note.response.note}
          readOnly={readOnly}
          onChange={(value) => {
            set({ response: { ...note.response, note: value } });
          }}
        />
        {/* SES-06: an adverse event, described, alerts the consultant and the Clinical Director. */}
        <label className="flex min-h-row items-center gap-3 pointer-coarse:min-h-row-touch">
          <input
            type="checkbox"
            className={tick}
            disabled={readOnly}
            checked={note.response.adverseEvent.reported}
            onChange={(event) => {
              set({
                response: {
                  ...note.response,
                  adverseEvent: { ...note.response.adverseEvent, reported: event.target.checked },
                },
              });
            }}
          />
          Adverse event
        </label>
        {note.response.adverseEvent.reported ? (
          <>
            <Note
              label="Describe the adverse event"
              value={note.response.adverseEvent.description}
              readOnly={readOnly}
              onChange={(description) => {
                set({
                  response: {
                    ...note.response,
                    adverseEvent: { ...note.response.adverseEvent, description },
                  },
                });
              }}
            />
            {editable ? (
              <p className="text-sm text-waiting-strong">
                Closing the session gives the consultant and the Clinical Director a task.
              </p>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="Home programme">
        {plan.homeProgramme.length > 0 ? (
          <ul className="flex flex-col gap-1" data-testid="home-programme">
            {plan.homeProgramme.map((row, index) => (
              <li key={[index, row.exercise].join('-')}>
                {row.exercise}
                {row.dose ? <span className="text-ink-secondary"> · {row.dose}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">The plan has no home programme.</p>
        )}
        <Note
          label="Changes today"
          value={note.homeProgramme.note}
          readOnly={readOnly}
          onChange={(value) => {
            set({ homeProgramme: { note: value } });
          }}
        />
      </Section>

      <Section title="Next session">
        <Choices
          name="next-session"
          options={nextSessionPlans}
          labels={nextSessionPlanLabels}
          value={note.nextSession.plan}
          readOnly={readOnly}
          onChange={(value) => {
            set({ nextSession: { ...note.nextSession, plan: value } });
          }}
        />
        <Note
          label="Plan for next time"
          value={note.nextSession.note}
          readOnly={readOnly}
          onChange={(value) => {
            set({ nextSession: { ...note.nextSession, note: value } });
          }}
        />
      </Section>

      {editable && blockers.length > 0 ? (
        <div className={panel}>
          <p className="font-medium text-ink">Before closing</p>
          <ul
            data-testid="close-blockers"
            className="flex flex-col gap-0.5 text-sm text-ink-secondary"
          >
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {editable ? (
        <div className="fixed inset-x-0 bottom-0 z-10 flex flex-col gap-2 border-t border-line bg-surface px-4 py-3 md:static md:border-0 md:bg-transparent md:p-0">
          <button
            type="button"
            disabled={blockers.length > 0 || saving || pending}
            onClick={() => void close()}
            className={`${primaryButtonClass} md:w-auto md:self-start`}
          >
            {saving || pending ? 'Closing…' : 'Close session'}
          </button>
          {unsaved ? (
            <p className="text-sm text-danger">
              Your latest changes are not saved yet. Check the connection and try again.
            </p>
          ) : null}
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
