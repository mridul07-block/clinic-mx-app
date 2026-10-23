'use client';

import { useActionState } from 'react';
import { primaryButtonClass, secondaryButtonClass } from '../../../../../components/forms';
import {
  checkInAction,
  undoCheckInAction,
  type TodayFormState,
} from '../../../../../modules/front-desk/actions';

const initialState: TodayFormState = {};

/** A row's one tap action: as wide as its words, not the row. */
const fit = (buttonClass: string) => `${buttonClass.replace('w-full', 'w-auto')} shrink-0`;

interface RowPlace {
  appointmentId: string;
  centreId: string;
  /** The chip picked, kept after the post. */
  show?: string;
  /** Who it is for, so each row's button has its own name. */
  patientName: string;
}

function Fields({ place }: { place: RowPlace }) {
  return (
    <>
      <input type="hidden" name="appointmentId" value={place.appointmentId} />
      <input type="hidden" name="centreId" value={place.centreId} />
      {place.show ? <input type="hidden" name="show" value={place.show} /> : null}
    </>
  );
}

/** Check in (INT-01, PRD J2.1): Checked in with the arrival time, in one tap. */
export function CheckInButton({ place }: { place: RowPlace }) {
  const [state, action, pending] = useActionState(checkInAction, initialState);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Fields place={place} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Check in ${place.patientName}`}
        className={fit(primaryButtonClass)}
      >
        Check in
      </button>
      {state.error ? (
        <p role="alert" className="max-w-48 text-right text-sm text-danger-strong">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Undo a check in made by mistake (INT-01), on the appointment's day. */
export function UndoCheckInButton({ place }: { place: RowPlace }) {
  const [state, action, pending] = useActionState(undoCheckInAction, initialState);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Fields place={place} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Undo check in for ${place.patientName}`}
        className={fit(secondaryButtonClass)}
      >
        Undo check in
      </button>
      {state.error ? (
        <p role="alert" className="max-w-48 text-right text-sm text-danger-strong">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
