'use client';

import type { PatientMatch } from '@clinic-mx/db';
import { formatIndianPhone } from '@clinic-mx/schemas';
import { useActionState, useId } from 'react';
import {
  FormMessage,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addPatientAndBookAction,
  bookSlotAction,
  holdSlotAction,
  releaseSlotAction,
  type BookingFormState,
} from '../../../../../modules/scheduling/actions';

const initialState: BookingFormState = {};

/** Book beside a patient's name: as wide as its word, not the row. */
const bookButtonClass = `${primaryButtonClass.replace('w-full', 'w-auto')} shrink-0`;

/** A start to hold or book: its centre, physio, type and time (ISO). */
export interface SlotChoiceFields {
  centreId: string;
  physioId: string;
  appointmentTypeId: string;
  startsAt: string;
}

function ChoiceFields({ choice, view }: { choice: SlotChoiceFields; view?: string }) {
  return (
    <>
      <input type="hidden" name="centreId" value={choice.centreId} />
      <input type="hidden" name="physioId" value={choice.physioId} />
      <input type="hidden" name="appointmentTypeId" value={choice.appointmentTypeId} />
      <input type="hidden" name="startsAt" value={choice.startsAt} />
      {view ? <input type="hidden" name="view" value={view} /> : null}
    </>
  );
}

/**
 * Holds a start for the person and opens the booking sheet (SCH-07: the slot is held when the
 * type is picked). A post, never a link: links are fetched ahead and would hold slots.
 */
export function HoldButton({
  choice,
  view,
  label,
  name,
  className,
}: {
  choice: SlotChoiceFields;
  view?: string;
  label: string;
  /** The accessible name when the label alone is not enough, as "Book Session at 10:30". */
  name?: string;
  className: string;
}) {
  const [state, action, pending] = useActionState(holdSlotAction, initialState);
  return (
    <form action={action} className="contents">
      <ChoiceFields choice={choice} view={view} />
      <button type="submit" aria-label={name} disabled={pending} className={className}>
        {label}
      </button>
      {state.error ? (
        <span role="alert" className="basis-full text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/** Cancel on the booking sheet: gives the hold back. */
export function CancelBookingButton({
  centreId,
  date,
  view,
}: {
  centreId: string;
  date: string;
  view?: string;
}) {
  const [state, action, pending] = useActionState(releaseSlotAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="centreId" value={centreId} />
      <input type="hidden" name="date" value={date} />
      {view ? <input type="hidden" name="view" value={view} /> : null}
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        Cancel booking
      </button>
    </form>
  );
}

/** Book for a patient found by search or on the mobile typed. */
export function BookPatientButton({
  choice,
  view,
  patient,
}: {
  choice: SlotChoiceFields;
  view?: string;
  patient: PatientMatch;
}) {
  const [state, action, pending] = useActionState(bookSlotAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <ChoiceFields choice={choice} view={view} />
      <input type="hidden" name="patientId" value={patient.id} />
      <button
        type="submit"
        aria-label={`Book for ${patient.name}`}
        disabled={pending}
        className={bookButtonClass}
      >
        Book
      </button>
      {state.error ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/** A patient's name, OP number and mobile, in a result or match row. */
export function PatientLine({ patient }: { patient: PatientMatch }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium text-ink">{patient.name}</span>
      <span className="text-sm text-ink-secondary">
        <span className="font-mono">{patient.opNumber}</span> · {formatIndianPhone(patient.phone)}
      </span>
    </span>
  );
}

/**
 * A caller or walk in who is new: their name and mobile only (Frontend Specification "New booking
 * sheet"). A mobile already on file lists its patients first, each bookable, or staff confirm a
 * new person on it (as when adding a patient, SCH-01).
 */
export function NewPatientBookForm({ choice, view }: { choice: SlotChoiceFields; view?: string }) {
  const [state, action, pending] = useActionState(addPatientAndBookAction, initialState);
  const id = useId();
  const errors = state.fieldErrors ?? {};
  const matches = state.matches ?? [];
  const name = state.values?.name ?? '';
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <ChoiceFields choice={choice} view={view} />
        {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
        <TextField
          label="Name"
          name="name"
          autoComplete="off"
          maxLength={100}
          defaultValue={name}
          error={errors.name}
        />
        <TextField
          label="Mobile"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={state.values?.phone ?? ''}
          error={errors.phone}
        />
        {matches.length > 0 ? null : (
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            Add and book
          </button>
        )}
        {matches.length > 0 ? (
          <>
            <input type="hidden" name="confirmNewPerson" value="true" />
            <section
              aria-labelledby={`${id}-matches`}
              data-testid="phone-matches"
              className="flex flex-col gap-3 rounded-panel border border-waiting-line bg-waiting-soft p-4"
            >
              <h3 id={`${id}-matches`} className="font-semibold text-ink">
                This mobile is already on file
              </h3>
              <p className="text-ink-secondary">
                Book for one of these, or add {name || 'them'} as a new person on the same mobile.
              </p>
              <button type="submit" disabled={pending} className={secondaryButtonClass}>
                Add {name || 'them'} as a new person and book
              </button>
            </section>
          </>
        ) : null}
      </form>
      {matches.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {matches.map((match) => (
            <li key={match.id} className="flex items-center justify-between gap-3 py-2.5">
              <PatientLine patient={match} />
              <BookPatientButton choice={choice} view={view} patient={match} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
