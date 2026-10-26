'use client';

import { useActionState, useId, useState } from 'react';
import {
  FormMessage,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../../components/forms';
import {
  planSessionsAction,
  type PlanSessionsFormState,
} from '../../../../../../modules/scheduling/plan-sessions-actions';

const initialState: PlanSessionsFormState = {};

const weekdays = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
  { value: '7', label: 'Sun' },
];

const chip =
  'flex min-h-row cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface text-sm font-medium text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus pointer-coarse:min-h-row-touch';

const choiceRow = 'flex min-h-11 items-center gap-3 py-1';

/**
 * Book plan sessions (SCH-11, PRD J4.8): a start date, the plan's sessions a week as weekdays, one
 * time and a physio. "Check dates" lists the plan's remaining sessions; a date that is not free
 * shows why and offers the nearest free times that day, the next day, or Skip. "Book" books them
 * all at once. Editing the pattern hides the checked dates until they are checked again.
 */
export function PlanSessionsForm({
  episodeId,
  toBook,
  today,
  physios,
  suggestedPhysioId,
}: {
  episodeId: string;
  /** The plan's sessions left to book now. */
  toBook: number;
  today: string;
  physios: { id: string; name: string }[];
  suggestedPhysioId: string | undefined;
}) {
  const [state, action, pending] = useActionState(planSessionsAction, initialState);
  // The state the pattern was edited after: its checked dates no longer match.
  const [editedAfter, setEditedAfter] = useState<PlanSessionsFormState | null>(null);
  const physioField = useId();
  const pattern = state.pattern;
  const rows = editedAfter === state ? undefined : state.rows;
  const clashes = rows?.filter((row) => !row.free) ?? [];

  if (state.booked) {
    return (
      <div className="flex flex-col gap-2" data-testid="plan-sessions-booked">
        <FormMessage tone="info">
          Booked {state.booked.length} {state.booked.length === 1 ? 'session' : 'sessions'}. The
          plan sessions list is queued for WhatsApp.
        </FormMessage>
        <ul className="flex flex-col gap-1 text-sm">
          {state.booked.map((entry) => (
            <li key={entry.number} className="flex justify-between gap-3">
              <span>{entry.when}</span>
              <span className="font-mono text-ink-secondary">{entry.number}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (toBook === 0) {
    return (
      <p className="text-sm text-ink-muted" data-testid="plan-sessions-all-booked">
        All planned sessions are booked.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3" data-testid="plan-sessions-form">
      <input type="hidden" name="episodeId" value={episodeId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <fieldset
        className="flex flex-col gap-3"
        onChange={() => {
          setEditedAfter(state);
        }}
      >
        <legend className="sr-only">Pattern</legend>
        <TextField
          label="Start date"
          name="fromDate"
          type="date"
          min={today}
          defaultValue={pattern?.fromDate ?? today}
          error={state.fieldErrors?.fromDate}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 font-medium text-ink">Days</legend>
          <div className="grid grid-cols-7 gap-1 sm:max-w-md">
            {weekdays.map((day) => (
              <label key={day.value} className={chip}>
                <input
                  type="checkbox"
                  name="weekdays"
                  value={day.value}
                  defaultChecked={pattern?.weekdays.includes(day.value)}
                  className="sr-only"
                />
                {day.label}
              </label>
            ))}
          </div>
          {state.fieldErrors?.weekdays ? (
            <p className="text-sm text-danger">{state.fieldErrors.weekdays}</p>
          ) : null}
        </fieldset>
        <TextField
          label="Time"
          name="time"
          type="time"
          step={900}
          defaultValue={pattern?.time ?? ''}
          error={state.fieldErrors?.time}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={physioField} className="font-medium text-ink">
            Physio
          </label>
          <select
            id={physioField}
            name="physioId"
            defaultValue={pattern?.physioId ?? suggestedPhysioId ?? ''}
            className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs pointer-coarse:h-row-touch"
          >
            <option value="">Pick a physio</option>
            {physios.map((physio) => (
              <option key={physio.id} value={physio.id}>
                {physio.name}
                {physio.id === suggestedPhysioId ? ' (treating physio)' : ''}
              </option>
            ))}
          </select>
          {state.fieldErrors?.physioId ? (
            <p className="text-sm text-danger">{state.fieldErrors.physioId}</p>
          ) : null}
        </div>
      </fieldset>
      <button
        type="submit"
        name="intent"
        value="check"
        disabled={pending}
        className={`${rows ? secondaryButtonClass : primaryButtonClass} sm:w-auto sm:self-start`}
      >
        Check dates
      </button>

      {rows ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-secondary">
            {rows.length} {rows.length === 1 ? 'date' : 'dates'}
            {clashes.length > 0
              ? ` · ${String(clashes.length)} not free: pick another time or Skip`
              : ' · all free'}
          </p>
          <input type="hidden" name="clashes" value={clashes.length} />
          <ul className="flex flex-col gap-2" data-testid="plan-session-dates">
            {rows.map((row) => {
              if (row.free) {
                return (
                  <li
                    key={row.startsAt}
                    data-testid="plan-session-date"
                    className="flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-3 py-2 text-sm"
                  >
                    <input type="hidden" name="starts" value={row.startsAt} />
                    <span>{row.when}</span>
                    <span className="text-ink-secondary">Free</span>
                  </li>
                );
              }
              const index = clashes.indexOf(row);
              const name = ['clash', index].join('-');
              return (
                <li
                  key={row.startsAt}
                  data-testid="plan-session-clash"
                  className="flex flex-col gap-1 rounded-panel border border-waiting-line bg-waiting-soft px-3 py-2 text-sm"
                >
                  <span className="font-medium text-ink">{row.when}</span>
                  <span className="text-waiting-strong">{row.reason}</span>
                  <fieldset className="flex flex-col">
                    <legend className="sr-only">Instead of {row.when}</legend>
                    {row.choices.map((choice) => (
                      <label key={choice.value} className={choiceRow}>
                        <input
                          type="radio"
                          name={name}
                          value={choice.value}
                          className="size-4 shrink-0 accent-accent"
                        />
                        {choice.label}
                      </label>
                    ))}
                    {row.choices.length === 0 ? (
                      <span className="text-ink-secondary">No free time that day or the next.</span>
                    ) : null}
                    <label className={choiceRow}>
                      <input
                        type="radio"
                        name={name}
                        value="skip"
                        className="size-4 shrink-0 accent-accent"
                      />
                      Skip
                    </label>
                  </fieldset>
                </li>
              );
            })}
          </ul>
          <button
            type="submit"
            name="intent"
            value="book"
            disabled={pending}
            className={`${primaryButtonClass} sm:w-auto sm:self-start`}
          >
            Book sessions
          </button>
        </div>
      ) : null}
    </form>
  );
}
