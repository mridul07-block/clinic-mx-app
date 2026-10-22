'use client';

import { useActionState, useState } from 'react';
import {
  FormMessage,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  cancelLeaveAction,
  decideLeaveAction,
  recordLeaveAction,
  requestLeaveAction,
  type RosterFormState,
} from '../../../../../modules/rosters/actions';

const initialState: RosterFormState = {};

const choiceClass =
  'flex min-h-row items-center gap-3 rounded-control px-1 text-ink pointer-coarse:min-h-row-touch';

/**
 * Leave as whole days or part of a day (SET-04). `staffUserId` set means a manager records it
 * for that person (approved at once); otherwise the signed in person requests their own.
 */
export function LeaveForm({
  staffUserId,
  today,
  slotMinutes,
}: {
  staffUserId?: string;
  today: string;
  slotMinutes: number;
}) {
  const [state, action, pending] = useActionState(
    staffUserId ? recordLeaveAction : requestLeaveAction,
    initialState,
  );
  const [kind, setKind] = useState(state.values?.kind === 'part' ? 'part' : 'days');
  const value = (field: string, fallback = '') => state.values?.[field] ?? fallback;
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {staffUserId ? <input type="hidden" name="staffUserId" value={staffUserId} /> : null}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-ink">Leave for</legend>
        {(
          [
            ['days', 'Whole days'],
            ['part', 'Part of a day'],
          ] as const
        ).map(([choice, label]) => (
          <label key={choice} className={choiceClass}>
            <input
              type="radio"
              name="kind"
              value={choice}
              checked={kind === choice}
              onChange={() => {
                setKind(choice);
              }}
              className="size-4 accent-accent"
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      {kind === 'days' ? (
        <>
          <TextField
            key="from"
            label="First day"
            name="from"
            type="date"
            min={staffUserId ? undefined : today}
            defaultValue={value('from', today)}
            error={errors.from}
          />
          <TextField
            key="to"
            label="Last day"
            name="to"
            type="date"
            min={staffUserId ? undefined : today}
            defaultValue={value('to', today)}
            error={errors.to}
          />
        </>
      ) : (
        <>
          <TextField
            key="date"
            label="Day"
            name="date"
            type="date"
            min={staffUserId ? undefined : today}
            defaultValue={value('date', today)}
            error={errors.date}
          />
          <TextField
            key="fromTime"
            label="From"
            name="fromTime"
            type="time"
            step={slotMinutes * 60}
            defaultValue={value('fromTime')}
            error={errors.fromTime}
          />
          <TextField
            key="toTime"
            label="To"
            name="toTime"
            type="time"
            step={slotMinutes * 60}
            defaultValue={value('toTime')}
            helper={`In steps of ${String(slotMinutes)} minutes.`}
            error={errors.toTime}
          />
        </>
      )}
      <TextField
        label="Note (optional)"
        name="note"
        autoComplete="off"
        maxLength={200}
        defaultValue={value('note')}
        helper="Seen by your manager. No health details needed."
        error={errors.note}
      />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Saving' : staffUserId ? 'Record leave' : 'Request leave'}
      </button>
    </form>
  );
}

/** Cancels leave after a confirm step; `back` is the page to return to. */
export function CancelLeaveForm({ leaveId, back }: { leaveId: string; back: string }) {
  const [state, action, pending] = useActionState(cancelLeaveAction, initialState);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          setConfirming(true);
        }}
      >
        Cancel leave
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="leaveId" value={leaveId} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" disabled={pending} className={dangerButtonClass}>
        {pending ? 'Cancelling' : 'Yes, cancel this leave'}
      </button>
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          setConfirming(false);
        }}
      >
        Keep it
      </button>
    </form>
  );
}

/** Approves requested leave, or declines it with a reason the person sees. */
export function DecideLeaveForm({ leaveId }: { leaveId: string }) {
  const [state, action, pending] = useActionState(decideLeaveAction, initialState);
  const [declining, setDeclining] = useState(state.values?.decision === 'decline');
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="leaveId" value={leaveId} />
      {declining ? (
        <>
          <input type="hidden" name="decision" value="decline" />
          <TextField
            label="Why it is declined"
            name="reason"
            autoComplete="off"
            maxLength={200}
            defaultValue={state.values?.reason ?? ''}
            error={state.fieldErrors?.reason}
          />
          <button type="submit" disabled={pending} className={dangerButtonClass}>
            {pending ? 'Declining' : 'Decline leave'}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setDeclining(false);
            }}
          >
            Back
          </button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="submit"
            name="decision"
            value="approve"
            disabled={pending}
            className={primaryButtonClass}
          >
            {pending ? 'Approving' : 'Approve'}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setDeclining(true);
            }}
          >
            Decline
          </button>
        </div>
      )}
    </form>
  );
}
