'use client';

import {
  ADVICE_MAX,
  DOSE_MAX,
  EXERCISE_MAX,
  EXERCISE_NOTE_MAX,
  GOAL_MAX,
  REASON_MAX,
  defaultReviewDate,
  formatIstDate,
  interventionKinds,
  interventionLabels,
  knowledgeRegions,
  modalityWarnings,
  planQuestionnaires,
  suggestedQuestionnaires,
  type AssessmentCondition,
  type ConsultationSections,
  type KnowledgeRegion,
  type PlanCatalog,
  type PlanDefaults,
  type PrecautionInForce,
} from '@clinic-mx/schemas';
import { useId, useState } from 'react';
import { secondaryButtonClass } from '../../../../../../components/forms';

type Plan = ConsultationSections['plan'];

const input =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken';
const check = 'size-5 shrink-0 accent-ink';
const GOALS_MAX = 20;
const EXERCISES_MAX = 30;

/** A whole number within bounds, or null for empty; anything else leaves the value as it was. */
const wholeIn = (text: string, min: number, max: number): number | null | undefined => {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
};

/**
 * Plan (CLN-07, PRD J3.7): goals with the patient's own, interventions, modalities warned against
 * the patient's precautions (a reason to keep one), frequency, the home programme typed for now
 * with the workbook's exercises beside it, the review date, outcome questionnaires suggested from
 * the diagnosis, and the treating physio (user decisions 24 October 2026).
 */
export function PlanInputs({
  plan,
  catalog,
  physios,
  defaults,
  region,
  condition,
  patientGoals,
  precautions,
  readOnly,
  onChange,
}: {
  plan: Plan;
  catalog: PlanCatalog;
  physios: { id: string; name: string }[];
  defaults: PlanDefaults;
  /** The Objective's workbook, whose questionnaires are offered. */
  region: KnowledgeRegion | undefined;
  /** The Assessment's condition, for suggested questionnaires and the workbook's exercises. */
  condition: AssessmentCondition | undefined;
  /** What the patient wrote as their goals (Subjective's confirmed value where changed). */
  patientGoals: string;
  precautions: PrecautionInForce[];
  readOnly: boolean;
  onChange: (plan: Plan) => void;
}) {
  const set = (next: Partial<Plan>) => {
    if (!readOnly) onChange({ ...plan, ...next });
  };
  const ids = useId();
  const id = (...parts: string[]) => [ids, ...parts].join('-');
  // SET-07: the exercise library, and the one chosen to add.
  const library = catalog.exercises ?? [];
  const [picked, setPicked] = useState('');
  const offered = planQuestionnaires(catalog, region);
  const suggested = suggestedQuestionnaires(offered, condition);
  const chosenQuestionnaires = plan.questionnaires ?? suggested;
  const defaultDate = defaultReviewDate(defaults.visitDate, defaults.reviewWeeks);
  const exercises = (condition?.listings ?? []).filter((listing) => listing.specificExercise);
  const patientGoalAdded = plan.goals.some(
    (goal) => goal.patient && goal.text === patientGoals.slice(0, GOAL_MAX),
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-labelledby={id('goals')}>
        <h3 id={id('goals')} className="text-md font-semibold">
          Goals
        </h3>
        {patientGoals ? (
          <div className="flex flex-col items-start gap-1.5 rounded-panel border border-line px-3 py-2.5">
            <p className="text-sm text-ink-secondary">
              <span className="font-medium">Patient’s goals:</span> {patientGoals}
            </p>
            {readOnly || patientGoalAdded ? null : (
              <button
                type="button"
                disabled={plan.goals.length >= GOALS_MAX}
                onClick={() => {
                  set({
                    goals: [
                      ...plan.goals,
                      { text: patientGoals.slice(0, GOAL_MAX), patient: true },
                    ],
                  });
                }}
                className="text-sm underline underline-offset-2"
              >
                Add as a goal
              </button>
            )}
          </div>
        ) : null}
        {plan.goals.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {plan.goals.map((goal, index) => {
              const update = (next: Partial<typeof goal>) => {
                set({
                  goals: plan.goals.map((g, at) => (at === index ? { ...g, ...next } : g)),
                });
              };
              return (
                <li
                  // Rows have no ids; each keeps its place until removed.
                  key={index}
                  data-testid="goal"
                  className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3"
                >
                  <input
                    type="text"
                    aria-label={['Goal', String(index + 1)].join(' ')}
                    maxLength={GOAL_MAX}
                    readOnly={readOnly}
                    value={goal.text}
                    onChange={(event) => {
                      update({ text: event.target.value });
                    }}
                    className={input}
                  />
                  <span className="flex shrink-0 items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={readOnly}
                        checked={goal.patient}
                        onChange={(event) => {
                          update({ patient: event.target.checked });
                        }}
                        className={check}
                      />
                      Patient’s goal
                    </label>
                    {readOnly ? null : (
                      <button
                        type="button"
                        onClick={() => {
                          set({ goals: plan.goals.filter((_, at) => at !== index) });
                        }}
                        className="text-sm underline underline-offset-2"
                        aria-label={['Remove goal', String(index + 1)].join(' ')}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {readOnly ? null : (
          <button
            type="button"
            disabled={plan.goals.length >= GOALS_MAX}
            onClick={() => {
              set({ goals: [...plan.goals, { text: '', patient: false }] });
            }}
            className={`${secondaryButtonClass} self-start md:w-auto`}
          >
            Add a goal
          </button>
        )}
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-md font-semibold">Interventions</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {interventionKinds.map((kind) => (
            <label key={kind} className="flex min-h-row items-center gap-2">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={plan.interventions.includes(kind)}
                onChange={(event) => {
                  set({
                    interventions: event.target.checked
                      ? interventionKinds.filter(
                          (k) => k === kind || plan.interventions.includes(k),
                        )
                      : plan.interventions.filter((k) => k !== kind),
                  });
                }}
                className={check}
              />
              {interventionLabels[kind]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-md font-semibold">Modalities</legend>
        <ul className="flex flex-col gap-2">
          {catalog.modalities.map((modality) => {
            const chosen = plan.modalities.find((m) => m.key === modality.key);
            const warnings = modalityWarnings(modality, precautions);
            return (
              <li key={modality.key} data-testid="modality" data-modality={modality.key}>
                <label className="flex min-h-row items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={chosen !== undefined}
                    onChange={(event) => {
                      set({
                        modalities: event.target.checked
                          ? [...plan.modalities, { key: modality.key, reason: '' }]
                          : plan.modalities.filter((m) => m.key !== modality.key),
                      });
                    }}
                    className={check}
                  />
                  {modality.name}
                </label>
                {chosen && warnings.length > 0 ? (
                  <div
                    data-testid="modality-warning"
                    className="mt-1.5 flex flex-col gap-1.5 rounded-panel border border-waiting-line bg-waiting-soft px-3 py-2.5 text-waiting-strong"
                  >
                    <p className="font-medium">Precaution</p>
                    <ul className="flex flex-col gap-1 text-sm">
                      {warnings.map((warning) => (
                        <li key={warning.key}>
                          {warning.by === 'clinician' ? 'Confirmed' : 'Patient ticked'}:{' '}
                          {warning.label} · {warning.source}
                        </li>
                      ))}
                    </ul>
                    {modality.signedOff ? null : (
                      <p className="text-sm">Awaiting clinical sign-off.</p>
                    )}
                    <label className="flex flex-col gap-1 text-ink">
                      <span className="text-sm font-medium">Reason to keep it</span>
                      <input
                        type="text"
                        maxLength={REASON_MAX}
                        readOnly={readOnly}
                        value={chosen.reason}
                        onChange={(event) => {
                          set({
                            modalities: plan.modalities.map((m) =>
                              m.key === modality.key ? { ...m, reason: event.target.value } : m,
                            ),
                          });
                        }}
                        className={input}
                      />
                    </label>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-md font-semibold">Frequency</legend>
        <div className="flex gap-3 md:w-96">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm text-ink-secondary">Sessions a week</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={7}
              readOnly={readOnly}
              value={plan.sessionsPerWeek ?? ''}
              onChange={(event) => {
                const value = wholeIn(event.target.value, 1, 7);
                if (value !== undefined) set({ sessionsPerWeek: value });
              }}
              className={input}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm text-ink-secondary">Weeks</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={52}
              readOnly={readOnly}
              value={plan.weeks ?? ''}
              onChange={(event) => {
                const value = wholeIn(event.target.value, 1, 52);
                if (value !== undefined) set({ weeks: value });
              }}
              className={input}
            />
          </label>
        </div>
      </fieldset>

      <section className="flex flex-col gap-2" aria-labelledby={id('home')}>
        <h3 id={id('home')} className="text-md font-semibold">
          Home programme
        </h3>
        {plan.homeProgramme.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
            {plan.homeProgramme.map((row, index) => {
              const update = (next: Partial<typeof row>) => {
                set({
                  homeProgramme: plan.homeProgramme.map((r, at) =>
                    at === index ? { ...r, ...next } : r,
                  ),
                });
              };
              const field = (key: keyof typeof row, label: string, max: number) => (
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm text-ink-secondary">{label}</span>
                  <input
                    type="text"
                    maxLength={max}
                    readOnly={readOnly}
                    value={row[key]}
                    onChange={(event) => {
                      // SET-07: a library exercise renamed is no longer that exercise, nor its video.
                      update(
                        key === 'exercise'
                          ? { exercise: event.target.value, exerciseId: undefined }
                          : { [key]: event.target.value },
                      );
                    }}
                    className={input}
                  />
                </label>
              );
              return (
                <li
                  key={index}
                  data-testid="exercise"
                  className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-end"
                >
                  {field('exercise', 'Exercise', EXERCISE_MAX)}
                  {field('dose', 'Dose', DOSE_MAX)}
                  {field('note', 'Note', EXERCISE_NOTE_MAX)}
                  {row.exerciseId ? (
                    <p className="text-sm text-ink-muted md:self-center" data-testid="from-library">
                      {library.find((each) => each.id === row.exerciseId)?.video
                        ? 'From the library, with its video'
                        : 'From the library'}
                    </p>
                  ) : null}
                  {readOnly ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        set({ homeProgramme: plan.homeProgramme.filter((_, at) => at !== index) });
                      }}
                      className="self-start text-sm underline underline-offset-2 md:self-center"
                      aria-label={['Remove exercise', String(index + 1)].join(' ')}
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        {readOnly || library.length === 0 ? null : (
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm text-ink-secondary">From the exercise library</span>
              <select
                value={picked}
                onChange={(event) => {
                  setPicked(event.target.value);
                }}
                className={input}
              >
                <option value="">Choose an exercise</option>
                {library.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.name} ({each.defaultDose}){each.video ? ', video' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!picked || plan.homeProgramme.length >= EXERCISES_MAX}
              onClick={() => {
                const chosen = library.find((each) => each.id === picked);
                if (!chosen) return;
                set({
                  homeProgramme: [
                    ...plan.homeProgramme,
                    {
                      exercise: chosen.name,
                      dose: chosen.defaultDose,
                      note: '',
                      exerciseId: chosen.id,
                    },
                  ],
                });
                setPicked('');
              }}
              className={`${secondaryButtonClass} self-start md:w-auto`}
            >
              Add from library
            </button>
          </div>
        )}
        {readOnly ? null : (
          <button
            type="button"
            disabled={plan.homeProgramme.length >= EXERCISES_MAX}
            onClick={() => {
              set({ homeProgramme: [...plan.homeProgramme, { exercise: '', dose: '', note: '' }] });
            }}
            className={`${secondaryButtonClass} self-start md:w-auto`}
          >
            Add an exercise
          </button>
        )}
        {exercises.map((listing) => (
          <p
            key={listing.region}
            data-testid="workbook-exercise"
            className="text-sm text-ink-secondary"
          >
            <span className="font-medium">
              From the {knowledgeRegions[listing.region].label} workbook:
            </span>{' '}
            {listing.specificExercise}
          </p>
        ))}
        <p className="text-sm text-ink-muted">
          Picking exercises with videos from the library arrives with the exercise library.
        </p>
      </section>

      {(
        [
          [
            'investigations',
            'Investigations advised',
            'For example, an MRI of the right knee if no better in 4 weeks.',
          ],
          ['referral', 'Referral advised', 'For example, an orthopaedic opinion, and why.'],
        ] as const
      ).map(([field, label, example]) => (
        <label key={field} className="flex flex-col gap-1.5">
          <span className="text-md font-semibold">
            {label} <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <textarea
            rows={2}
            maxLength={ADVICE_MAX}
            readOnly={readOnly}
            value={plan[field]}
            aria-describedby={id(field, 'hint')}
            onChange={(event) => {
              set({ [field]: event.target.value });
            }}
            className={input}
          />
          <span id={id(field, 'hint')} className="text-sm text-ink-muted">
            {example} Printed on the patient’s summary when filled.
          </span>
        </label>
      ))}

      <label className="flex flex-col gap-1.5 md:w-72">
        <span className="text-md font-semibold">Review date</span>
        <input
          type="date"
          min={defaults.visitDate}
          readOnly={readOnly}
          value={plan.reviewDate || defaultDate}
          onChange={(event) => {
            set({ reviewDate: event.target.value });
          }}
          className={input}
        />
        <span className="text-sm text-ink-muted">
          Default {formatIstDate(defaultDate)}: {defaults.reviewWeeks} weeks after the visit.
        </span>
      </label>

      <fieldset data-testid="questionnaires" className="flex flex-col gap-2">
        <legend className="mb-2 text-md font-semibold">Outcome questionnaires</legend>
        <ul className="flex flex-col gap-2">
          {offered.map((questionnaire) => (
            <li key={questionnaire.key}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={chosenQuestionnaires.includes(questionnaire.key)}
                  onChange={(event) => {
                    set({
                      questionnaires: event.target.checked
                        ? [...chosenQuestionnaires, questionnaire.key]
                        : chosenQuestionnaires.filter((key) => key !== questionnaire.key),
                    });
                  }}
                  className={`${check} mt-0.5`}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {questionnaire.name}
                    {suggested.includes(questionnaire.key) ? (
                      <span className="rounded-full border border-current px-1.5 text-xs font-normal">
                        Suggested
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm text-ink-muted">{questionnaire.useFor}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-muted">
          {plan.questionnaires === null
            ? 'Suggested from the diagnosis until you change the list. '
            : ''}
          Questions and scoring arrive with the questionnaire library.
        </p>
      </fieldset>

      <label className="flex flex-col gap-1.5 md:w-96">
        <span className="text-md font-semibold">Treating physio</span>
        <select
          value={plan.treatingPhysioId || defaults.consultantId}
          disabled={readOnly}
          onChange={(event) => {
            set({ treatingPhysioId: event.target.value });
          }}
          className={`${input} disabled:bg-surface-sunken`}
        >
          {physios.map((physio) => (
            <option key={physio.id} value={physio.id}>
              {physio.id === defaults.consultantId ? `${physio.name} (you)` : physio.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
