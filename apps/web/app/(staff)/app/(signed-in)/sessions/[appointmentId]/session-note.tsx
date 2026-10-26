'use client';

import {
  formatIstDateTime,
  interventionLabels,
  nextSessionPlanLabels,
  nextSessionPlans,
  painReadingLabels,
  painReadings,
  sessionNoteBlockers,
  sessionNoteSchema,
  sessionResponseLabels,
  sessionResponses,
  type InterventionKind,
  type SessionNote,
} from '@clinic-mx/schemas';
import { startTransition, useActionState, useMemo, useState, type ReactNode } from 'react';
import { primaryButtonClass } from '../../../../../../components/forms';
import { PainSlider } from '../../../../../../components/pain-slider';
import { ConflictNotice } from '../../../../../../lib/drafts/conflict-notice';
import { SaveStatus } from '../../../../../../lib/drafts/save-status';
import { saveSessionNoteDraft } from '../../../../../../lib/drafts/savers';
import { useAutosave } from '../../../../../../lib/drafts/use-autosave';
import {
  closeSessionAction,
  type CloseSessionState,
} from '../../../../../../modules/sessions/actions';

const textarea =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken';
const choice =
  'flex min-h-row flex-1 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-3 font-medium has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus has-[:disabled]:cursor-default pointer-coarse:min-h-row-touch';
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

/** One-tap choices, as radios that look like buttons. */
function Choices<T extends string>({
  name,
  options,
  labels,
  value,
  readOnly,
  onChange,
}: {
  name: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | null;
  readOnly: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <label key={option} className={choice}>
          <input
            type="radio"
            name={name}
            className="sr-only"
            disabled={readOnly}
            checked={value === option}
            onChange={() => {
              onChange(option);
            }}
          />
          {labels[option]}
        </label>
      ))}
    </div>
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

/**
 * The session note (SES-03, PRD J5.4; user decisions 26 October 2026): new symptoms first, then
 * since last visit, the three pain sliders, the treatment given as ticks from the plan, the
 * response, home programme changes and the next session; autosaved as it is written. Close
 * session saves what is left and signs it at that version.
 */
export function SessionNoteForm({
  appointmentId,
  serverValue,
  serverVersion,
  editable,
  signed,
  plan,
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
  const blockers = sessionNoteBlockers(note);
  const [state, action, pending] = useActionState(closeSessionAction, initialState);
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);

  // The ticks: the plan's, and any the note carries from last time.
  const interventions = [
    ...new Set([...plan.interventions, ...note.treatment.interventions]),
  ] as InterventionKind[];
  const modalities = [
    ...plan.modalities,
    ...note.treatment.modalities
      .filter((key) => !plan.modalities.some((modality) => modality.key === key))
      .map((key) => ({ key, name: key })),
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
          {modalities.map((modality) => (
            <label
              key={modality.key}
              className="flex min-h-row items-center gap-3 pointer-coarse:min-h-row-touch"
            >
              <input
                type="checkbox"
                className={tick}
                disabled={readOnly}
                checked={note.treatment.modalities.includes(modality.key)}
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
          ))}
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
