'use client';

import type { SettingInputKind } from '@clinic-mx/schemas';
import { useActionState, useId } from 'react';
import { FormMessage, secondaryButtonClass } from '../../../../../components/forms';
import {
  changeSettingAction,
  type SettingFormState,
} from '../../../../../modules/settings/actions';

const initialState: SettingFormState = {};

const controlClass =
  'w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs hover:border-ink-muted';

/** One setting's new value, asked the way its schema takes it (ADM-02), then "Save". */
export function SettingForm({
  settingKey,
  kind,
  choices,
  text,
  seenAt,
  negative,
}: {
  settingKey: string;
  kind: SettingInputKind;
  choices: string[];
  text: string;
  seenAt: string;
  /** A number that may be below zero: the full keyboard, as phone keypads lack a minus. */
  negative: boolean;
}) {
  const [state, action, pending] = useActionState(changeSettingAction, initialState);
  const id = useId();
  const value = state.value ?? text;
  const errorId = [id, 'error'].join('-');
  const described = state.error ? errorId : undefined;
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="setting-form">
      <input type="hidden" name="key" value={settingKey} />
      <input type="hidden" name="seenAt" value={seenAt} />
      <label htmlFor={id} className="text-sm font-medium text-ink">
        New value
      </label>
      {kind === 'json' ? (
        <textarea
          id={id}
          name="value"
          defaultValue={value}
          rows={Math.min(12, value.split('\n').length + 1)}
          spellCheck={false}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={described}
          className={`${controlClass} py-2 font-mono text-sm`}
        />
      ) : kind === 'yes_no' || kind === 'choice' ? (
        <select
          id={id}
          name="value"
          defaultValue={value}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={described}
          className={`${controlClass} h-row pointer-coarse:h-row-touch`}
        >
          {(kind === 'yes_no' ? ['yes', 'no'] : choices).map((choice) => (
            <option key={choice} value={choice}>
              {kind === 'yes_no' ? (choice === 'yes' ? 'Yes' : 'No') : choice}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name="value"
          defaultValue={value}
          inputMode={kind === 'number' && !negative ? 'decimal' : undefined}
          autoComplete="off"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={described}
          className={`${controlClass} h-row pointer-coarse:h-row-touch ${kind === 'text' ? 'font-mono' : 'tabular-nums'}`}
        />
      )}
      {state.error ? (
        <p id={errorId} className="text-sm text-danger" data-testid="setting-error">
          {state.error}
        </p>
      ) : null}
      {state.done ? <FormMessage tone="info">{state.done}</FormMessage> : null}
      <button type="submit" disabled={pending} className={`${secondaryButtonClass} sm:w-auto`}>
        Save
      </button>
    </form>
  );
}
