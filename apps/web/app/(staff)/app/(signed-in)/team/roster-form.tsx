'use client';

import { formatBlocks, weekdayNames, type Weekly } from '@clinic-mx/schemas';
import { useActionState, useId, useState } from 'react';
import { FormMessage, TextField, primaryButtonClass } from '../../../../../components/forms';
import { saveRosterAction, type RosterFormState } from '../../../../../modules/rosters/actions';

const initialState: RosterFormState = {};

/** A day's blocks as the form shows them: "09:00-13:00, 14:00-18:00", blank when not working. */
const dayText = (blocks: Weekly[number] | undefined) =>
  blocks && blocks.length > 0 ? formatBlocks(blocks).replaceAll('–', '-') : '';

/**
 * A person's weekly hours at one centre, from a date (SET-04). Choosing a centre fills the days
 * with the hours in effect there, to change from the chosen date.
 */
export function RosterForm({
  staffUserId,
  centres,
  today,
  slotMinutes,
}: {
  staffUserId: string;
  /** Centres the person works at that the manager sees, with the week in effect, if any. */
  centres: { id: string; name: string; current?: Weekly }[];
  today: string;
  slotMinutes: number;
}) {
  const [state, action, pending] = useActionState(saveRosterAction, initialState);
  const [centreId, setCentreId] = useState(state.values?.centreId ?? centres[0]?.id ?? '');
  const id = useId();
  const current = centres.find((c) => c.id === centreId)?.current;
  const errors = state.fieldErrors ?? {};
  // Typed values come back only for the centre they were typed for.
  const typed = state.values?.centreId === centreId ? state.values : undefined;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="staffUserId" value={staffUserId} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-centre`} className="font-medium text-ink">
          Centre
        </label>
        <select
          id={`${id}-centre`}
          name="centreId"
          value={centreId}
          onChange={(event) => {
            setCentreId(event.target.value);
          }}
          className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs pointer-coarse:h-row-touch"
        >
          {centres.map((centre) => (
            <option key={centre.id} value={centre.id}>
              {centre.name}
            </option>
          ))}
        </select>
        {errors.centreId ? <p className="text-sm text-danger">{errors.centreId}</p> : null}
      </div>
      <TextField
        label="From"
        name="effectiveFrom"
        type="date"
        min={today}
        defaultValue={typed?.effectiveFrom ?? today}
        helper="Weeks before this date keep the hours they had."
        error={errors.effectiveFrom}
      />
      <p className="text-ink-secondary">
        24 hour times in steps of {slotMinutes} minutes, for example 09:00-13:00, 14:00-18:00. Leave
        a day blank when they do not work there.
      </p>
      <div key={centreId} className="flex flex-col gap-4">
        {weekdayNames.map((day, i) => (
          <TextField
            key={day}
            label={day}
            name={`day${String(i)}`}
            autoComplete="off"
            defaultValue={typed?.[`day${String(i)}`] ?? dayText(current?.[i])}
            error={errors[`day${String(i)}`]}
          />
        ))}
      </div>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : 'Save hours'}
      </button>
    </form>
  );
}
