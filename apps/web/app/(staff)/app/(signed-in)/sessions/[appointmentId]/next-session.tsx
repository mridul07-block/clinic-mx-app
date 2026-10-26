'use client';

import { useActionState, useState } from 'react';
import {
  FormMessage,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../../components/forms';
import {
  nextSessionAction,
  type NextSessionFormState,
} from '../../../../../../modules/scheduling/next-session-actions';

const initialState: NextSessionFormState = {};

const timeChip =
  'flex min-h-row cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-2 text-sm font-medium tabular-nums text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus pointer-coarse:min-h-row-touch';

/**
 * Next session (SCH-12): the physio writing the note books the patient's next Session into their
 * own free time. A date (offered from the plan's frequency), "Show times", a tap on a time, Book.
 * Changing the date hides the times until they are shown again.
 */
export function NextSessionPanel({
  appointmentId,
  toBook,
  defaultDate,
  today,
}: {
  appointmentId: string;
  toBook: number;
  defaultDate: string;
  today: string;
}) {
  const [state, action, pending] = useActionState(nextSessionAction, initialState);
  // The state the date was changed after: its times are for another day.
  const [editedAfter, setEditedAfter] = useState<NextSessionFormState | null>(null);
  const times = editedAfter === state ? undefined : state.times;

  return (
    <section
      aria-labelledby="next-session"
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
      data-testid="next-session"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="next-session" className="font-semibold text-ink">
          Next session
        </h2>
        <span className="text-sm tabular-nums text-ink-secondary" data-testid="next-session-left">
          {toBook} to book
        </span>
      </div>
      {state.booked ? (
        <FormMessage tone="info">
          <span data-testid="next-session-booked">
            Booked {state.booked.when} ·{' '}
            <span className="whitespace-nowrap font-mono">{state.booked.number}</span>
          </span>
        </FormMessage>
      ) : null}
      {toBook === 0 ? (
        <p className="text-sm text-ink-muted" data-testid="next-session-all-booked">
          All planned sessions are booked.
        </p>
      ) : (
        <form action={action} className="flex flex-col gap-3" data-testid="next-session-form">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
          <div
            onChange={() => {
              setEditedAfter(state);
            }}
          >
            <TextField
              label="Date"
              name="date"
              type="date"
              min={today}
              defaultValue={state.date ?? defaultDate}
            />
          </div>
          <button
            type="submit"
            name="intent"
            value="show"
            disabled={pending}
            className={`${times ? secondaryButtonClass : primaryButtonClass} sm:w-auto sm:self-start`}
          >
            Show times
          </button>
          {times ? (
            times.length === 0 ? (
              <p className="text-sm text-ink-muted">No free time that day. Pick another date.</p>
            ) : (
              <>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 text-sm text-ink-secondary">Your free times</legend>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                    {times.map((time) => (
                      <label key={time.value} className={timeChip}>
                        <input
                          type="radio"
                          name="startsAt"
                          value={time.value}
                          className="sr-only"
                        />
                        {time.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button
                  type="submit"
                  name="intent"
                  value="book"
                  disabled={pending}
                  className={`${primaryButtonClass} sm:w-auto sm:self-start`}
                >
                  Book next session
                </button>
              </>
            )
          ) : null}
        </form>
      )}
    </section>
  );
}
