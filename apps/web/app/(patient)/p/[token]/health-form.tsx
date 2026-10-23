'use client';

import type { HealthFormField, HealthFormRow } from '@clinic-mx/schemas';
import Link from 'next/link';
import {
  startTransition,
  useActionState,
  useId,
  useState,
  useSyncExternalStore,
  type SubmitEvent,
} from 'react';
import { shrinkPhotos } from '../../../../lib/shrink-photo';
import { saveScreenAction, type HealthFormState } from '../../../../modules/intake/actions';
import { BodyChart } from './body-chart';
import { patientPrimaryClass, patientSecondaryClass } from './patient-ui';

// A health form screen (INT-04, INT-05, Frontend Specification §7): one topic, a stepper, Yes / No
// as 64 px paired buttons, pain sliders with a large thumb and a readout, the body chart, the gold
// primary action pinned at the bottom. Plain form posts, so it works without scripts: follow ups
// show by CSS while the answer that shows them is ticked (the server ignores them otherwise), a
// pain slider is a row of 0 to 10 buttons until scripts run, and report photos go as they are.

const initialState: HealthFormState = {};

const choiceClass =
  'flex min-h-target-patient items-center gap-3 rounded-control border border-line-control bg-surface px-4 text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft';
const inputClass =
  'h-target-patient w-full rounded-control border border-line-control bg-surface px-4 text-lg text-ink aria-[invalid=true]:border-danger';
const pairClass =
  'flex min-h-16 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface text-lg font-semibold text-ink has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus';

type Value = string | string[] | undefined;

/** Many options, or short ones, sit two to a row so a screen stays short on a phone. */
const twoColumns = (options: readonly { label: string }[]) =>
  options.length > 8 || options.every((option) => option.label.length <= 16);

const noSubscription = () => () => undefined;
const inBrowser = () => true;
const onServer = () => false;

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={id} className="text-danger">
      {error}
    </p>
  ) : null;
}

/** A field's question, marked when it may be left for the physio. */
function Question({ field }: { field: HealthFormField }) {
  return (
    <>
      {field.label}
      {field.optional ? <span className="font-normal text-ink-secondary"> (optional)</span> : null}
    </>
  );
}

/** A pain slider: 0 to 10 with a large thumb and the number read out; buttons until scripts run. */
function PainScale({
  field,
  value,
  error,
}: {
  field: Extract<HealthFormField, { kind: 'scale' }>;
  value?: string;
  error?: string;
}) {
  const id = useId();
  const ready = useSyncExternalStore(noSubscription, inBrowser, onServer);
  const [chosen, setChosen] = useState(value ?? '');
  const numbers = Array.from({ length: field.max - field.min + 1 }, (_, i) => field.min + i);
  const ends = (
    <div className="flex justify-between gap-4 text-sm text-ink-secondary">
      <span>
        {field.min} {field.minLabel}
      </span>
      <span className="text-right">
        {field.max} {field.maxLabel}
      </span>
    </div>
  );
  return (
    <fieldset
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className="flex flex-col gap-3"
      data-scale={field.key}
    >
      <legend className="mb-3 font-medium text-ink">
        <Question field={field} />
      </legend>
      {ready ? (
        <>
          <input type="hidden" name={field.key} value={chosen} />
          <p
            className="text-lg font-semibold text-ink"
            aria-live="polite"
            data-testid="scale-readout"
          >
            {chosen === '' ? 'Not answered yet' : `${chosen} out of ${String(field.max)}`}
          </p>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={1}
            value={chosen === '' ? Math.round((field.min + field.max) / 2) : Number(chosen)}
            aria-label={field.label}
            aria-valuetext={
              chosen === '' ? 'Not answered yet' : `${chosen} out of ${String(field.max)}`
            }
            onChange={(event) => {
              setChosen(event.target.value);
            }}
            onPointerDown={(event) => {
              if (chosen === '') setChosen(event.currentTarget.value);
            }}
            data-untouched={chosen === '' ? '' : undefined}
            className="h-12 w-full cursor-pointer appearance-none bg-transparent data-[untouched]:opacity-60 [&::-moz-range-thumb]:size-9 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-line [&::-webkit-slider-thumb]:-mt-3.5 [&::-webkit-slider-thumb]:size-9 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
          />
          {ends}
        </>
      ) : (
        <>
          <div className="grid grid-cols-6 gap-2">
            {numbers.map((number) => (
              <label key={number} className={`${pairClass} min-h-12 text-base`}>
                <input
                  type="radio"
                  name={field.key}
                  value={number}
                  defaultChecked={value === String(number)}
                  className="sr-only"
                />
                {number}
              </label>
            ))}
          </div>
          {ends}
        </>
      )}
      <FieldError id={`${id}-error`} error={error} />
    </fieldset>
  );
}

function Field({
  field,
  value,
  error,
  trigger,
}: {
  field: HealthFormField;
  value: Value;
  error?: string;
  /** The answer that shows this question's follow ups, marked for the CSS that shows them. */
  trigger?: string;
}) {
  const id = useId();
  const one = typeof value === 'string' ? value : undefined;
  const many = typeof value === 'string' ? [value] : (value ?? []);
  const invalid = error ? true : undefined;
  const describedBy = error ? `${id}-error` : undefined;
  switch (field.kind) {
    case 'yes_no':
      return (
        <fieldset
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="flex flex-col gap-3"
        >
          <legend className="mb-3 font-medium text-ink">
            <Question field={field} />
          </legend>
          <div className="grid grid-cols-2 gap-3">
            {(['yes', 'no'] as const).map((answer) => (
              <label key={answer} className={pairClass}>
                <input
                  type="radio"
                  name={field.key}
                  value={answer}
                  defaultChecked={one === answer}
                  data-follow={trigger === answer ? '' : undefined}
                  className="sr-only"
                />
                {answer === 'yes' ? 'Yes' : 'No'}
              </label>
            ))}
          </div>
          <FieldError id={`${id}-error`} error={error} />
        </fieldset>
      );
    case 'single_choice':
    case 'multi_choice':
      return (
        <fieldset
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="flex flex-col gap-3"
        >
          <legend className="mb-3 font-medium text-ink">
            <Question field={field} />
          </legend>
          <div
            className={twoColumns(field.options) ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-3'}
          >
            {field.options.map((option) => (
              <label
                key={option.value}
                className={
                  twoColumns(field.options) ? `${choiceClass} px-3 text-base` : choiceClass
                }
              >
                <input
                  type={field.kind === 'single_choice' ? 'radio' : 'checkbox'}
                  name={field.key}
                  value={option.value}
                  defaultChecked={many.includes(option.value)}
                  data-follow={trigger === option.value ? '' : undefined}
                  className="size-5 shrink-0 accent-accent"
                />
                {option.label}
              </label>
            ))}
          </div>
          <FieldError id={`${id}-error`} error={error} />
        </fieldset>
      );
    case 'body_chart':
      return (
        <fieldset
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="flex flex-col gap-3"
        >
          <legend className="mb-3 font-medium text-ink">
            <Question field={field} />
          </legend>
          <BodyChart name={field.key} chosen={many} />
          <FieldError id={`${id}-error`} error={error} />
        </fieldset>
      );
    case 'scale':
      return <PainScale field={field} value={one} error={error} />;
    case 'number':
    case 'date':
      return (
        <div className="flex flex-col gap-2">
          <label htmlFor={id} className="font-medium text-ink">
            <Question field={field} />
          </label>
          <div className="flex items-center gap-3">
            <input
              id={id}
              name={field.key}
              type={field.kind === 'date' ? 'date' : 'text'}
              inputMode={field.kind === 'number' ? 'numeric' : undefined}
              autoComplete={field.kind === 'date' ? 'bday' : 'off'}
              defaultValue={one ?? ''}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className={`${inputClass} ${field.kind === 'date' ? 'max-w-56' : 'max-w-32'}`}
            />
            {field.kind === 'number' && field.unit ? (
              <span className="text-ink-secondary">{field.unit}</span>
            ) : null}
          </div>
          <FieldError id={`${id}-error`} error={error} />
        </div>
      );
    case 'text':
      return (
        <div className="flex flex-col gap-2">
          <label htmlFor={id} className="font-medium text-ink">
            <Question field={field} />
          </label>
          <textarea
            id={id}
            name={field.key}
            rows={field.maxLength > 100 ? 3 : 1}
            maxLength={field.maxLength}
            defaultValue={one ?? ''}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={`${inputClass} h-auto py-3`}
          />
          <FieldError id={`${id}-error`} error={error} />
        </div>
      );
  }
}

/** Report photos on History (INT-05): optional, photos or PDFs, shrunk on the phone. */
function ReportPhotos({
  maxMegabytes,
  added,
  error,
}: {
  maxMegabytes: number;
  added: number;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2" data-testid="report-photos">
      <label htmlFor={id} className="font-medium text-ink">
        Add a photo of a report
        <span className="font-normal text-ink-secondary"> (optional)</span>
      </label>
      <p className="text-ink-secondary">Photos or PDFs, up to {maxMegabytes} MB each.</p>
      {added > 0 ? (
        <p className="text-ink" data-testid="reports-added">
          {added === 1 ? '1 report added.' : `${String(added)} reports added.`}
        </p>
      ) : null}
      <input
        id={id}
        type="file"
        name="reports"
        multiple
        accept="image/jpeg,image/png,image/heic,application/pdf"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="text-ink file:mr-3 file:h-target-patient file:rounded-control file:border file:border-line-control file:bg-surface file:px-4 file:text-ink"
      />
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

/** One screen: its questions, follow ups under the question that shows them, Back and Next. */
export function HealthFormScreenForm({
  token,
  screenKey,
  rows,
  saved,
  backHref,
  reports,
}: {
  token: string;
  screenKey: string;
  rows: HealthFormRow[];
  /** The screen's answers as saved, as the form posts them. */
  saved: Record<string, string | string[]>;
  backHref?: string;
  /** History takes report photos (INT-05). */
  reports?: { maxMegabytes: number; added: number };
}) {
  const [state, action, pending] = useActionState(saveScreenAction, initialState);
  const [preparing, setPreparing] = useState(false);
  const values = state.values ?? saved;
  const errors = state.errors ?? {};

  // With scripts, photos are shrunk before they are sent; without, they go as they are.
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    const form = new FormData(event.currentTarget);
    const chosen = form.getAll('reports').filter((v): v is File => v instanceof File && v.size > 0);
    if (chosen.length === 0) return;
    event.preventDefault();
    setPreparing(true);
    void shrinkPhotos(chosen)
      .then((files) => {
        form.delete('reports');
        for (const file of files) form.append('reports', file);
        startTransition(() => {
          action(form);
        });
      })
      .finally(() => {
        setPreparing(false);
      });
  };

  return (
    <form
      action={action}
      onSubmit={reports ? submit : undefined}
      noValidate
      className="flex flex-col gap-8 pb-28"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="screen" value={screenKey} />
      {state.errors ? (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-ink"
        >
          Please answer the questions marked below.
        </p>
      ) : null}
      <div key={state.attempt ?? 0} className="flex flex-col gap-8">
        {rows.map(({ field, followUps, trigger }) => (
          <div
            key={field.key}
            className="group/question flex flex-col gap-6"
            data-question={field.key}
          >
            <Field
              field={field}
              value={values[field.key]}
              error={errors[field.key]}
              trigger={followUps.length > 0 ? trigger : undefined}
            />
            {followUps.length > 0 ? (
              <div
                className="hidden flex-col gap-6 border-l-2 border-line pl-4 group-has-[>fieldset_input[data-follow]:checked]/question:flex"
                data-follow-ups={field.key}
              >
                {followUps.map((followUp) => (
                  <Field
                    key={followUp.key}
                    field={followUp}
                    value={values[followUp.key]}
                    error={errors[followUp.key]}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {reports ? (
          <ReportPhotos
            maxMegabytes={reports.maxMegabytes}
            added={reports.added}
            error={errors.reports}
          />
        ) : null}
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-signin gap-3">
          {backHref ? (
            <Link href={backHref} className={patientSecondaryClass}>
              Back
            </Link>
          ) : null}
          <button type="submit" disabled={pending || preparing} className={patientPrimaryClass}>
            {preparing ? 'Preparing' : 'Next'}
          </button>
        </div>
      </div>
    </form>
  );
}
