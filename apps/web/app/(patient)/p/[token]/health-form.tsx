'use client';

import type { HealthFormField, HealthFormRow } from '@clinic-mx/schemas';
import Link from 'next/link';
import { useActionState, useId } from 'react';
import { saveScreenAction, type HealthFormState } from '../../../../modules/intake/actions';
import { patientPrimaryClass, patientSecondaryClass } from './patient-ui';

// A health form screen (INT-04, Frontend Specification §7): one topic, a stepper, Yes / No as
// 64 px paired buttons, the gold primary action pinned at the bottom. Plain form posts, so it
// works without scripts: follow ups show by CSS while their question's yes is ticked, and the
// server ignores them otherwise.

const initialState: HealthFormState = {};

const choiceClass =
  'flex min-h-target-patient items-center gap-3 rounded-control border border-line-control bg-surface px-4 text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft';
const inputClass =
  'h-target-patient w-full rounded-control border border-line-control bg-surface px-4 text-lg text-ink aria-[invalid=true]:border-danger';

type Value = string | string[] | undefined;

function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={id} className="text-danger">
      {error}
    </p>
  ) : null;
}

function Field({ field, value, error }: { field: HealthFormField; value: Value; error?: string }) {
  const id = useId();
  const one = typeof value === 'string' ? value : undefined;
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
          <legend className="mb-3 font-medium text-ink">{field.label}</legend>
          <div className="grid grid-cols-2 gap-3">
            {(['yes', 'no'] as const).map((answer) => (
              <label
                key={answer}
                className="flex min-h-16 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface text-lg font-semibold text-ink has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
              >
                <input
                  type="radio"
                  name={field.key}
                  value={answer}
                  defaultChecked={one === answer}
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
    case 'multi_choice': {
      const chosen = typeof value === 'string' ? [value] : (value ?? []);
      return (
        <fieldset
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="flex flex-col gap-3"
        >
          <legend className="mb-3 font-medium text-ink">{field.label}</legend>
          {field.options.map((option) => (
            <label key={option.value} className={choiceClass}>
              <input
                type={field.kind === 'single_choice' ? 'radio' : 'checkbox'}
                name={field.key}
                value={option.value}
                defaultChecked={chosen.includes(option.value)}
                className="size-5 shrink-0 accent-accent"
              />
              {option.label}
            </label>
          ))}
          <FieldError id={`${id}-error`} error={error} />
        </fieldset>
      );
    }
    case 'number':
      return (
        <div className="flex flex-col gap-2">
          <label htmlFor={id} className="font-medium text-ink">
            {field.label}
          </label>
          <div className="flex items-center gap-3">
            <input
              id={id}
              name={field.key}
              inputMode="numeric"
              autoComplete="off"
              defaultValue={one ?? ''}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className={`${inputClass} max-w-32`}
            />
            <span className="text-ink-secondary">{field.unit}</span>
          </div>
          <FieldError id={`${id}-error`} error={error} />
        </div>
      );
    case 'text':
      return (
        <div className="flex flex-col gap-2">
          <label htmlFor={id} className="font-medium text-ink">
            {field.label}
          </label>
          <textarea
            id={id}
            name={field.key}
            rows={3}
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

/** One screen: its questions, follow ups under the question that shows them, Back and Next. */
export function HealthFormScreenForm({
  token,
  screenKey,
  rows,
  saved,
  backHref,
}: {
  token: string;
  screenKey: string;
  rows: HealthFormRow[];
  /** The screen's answers as saved, as the form posts them. */
  saved: Record<string, string | string[]>;
  backHref?: string;
}) {
  const [state, action, pending] = useActionState(saveScreenAction, initialState);
  const values = state.values ?? saved;
  const errors = state.errors ?? {};
  return (
    <form action={action} noValidate className="flex flex-col gap-8 pb-28">
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
        {rows.map(({ field, followUps }) => (
          <div
            key={field.key}
            className="group/question flex flex-col gap-6"
            data-question={field.key}
          >
            <Field field={field} value={values[field.key]} error={errors[field.key]} />
            {followUps.length > 0 ? (
              <div
                className="hidden flex-col gap-6 border-l-2 border-line pl-4 group-has-[>fieldset_input[value=yes]:checked]/question:flex"
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
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-signin gap-3">
          {backHref ? (
            <Link href={backHref} className={patientSecondaryClass}>
              Back
            </Link>
          ) : null}
          <button type="submit" disabled={pending} className={patientPrimaryClass}>
            Next
          </button>
        </div>
      </div>
    </form>
  );
}
