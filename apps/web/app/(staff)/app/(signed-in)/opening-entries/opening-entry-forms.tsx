'use client';

import { OPENING_SESSIONS_MAX, formatIstDate } from '@clinic-mx/schemas';
import type { OpeningEntryRow } from '@clinic-mx/db';
import Link from 'next/link';
import { useActionState, useId, useState, useTransition, type SyntheticEvent } from 'react';
import {
  FormMessage,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addOpeningEntryAction,
  correctOpeningEntryAction,
  switchOpeningEntriesAction,
  type OpeningEntryFormState,
} from '../../../../../modules/opening-entries/actions';
import type { OpeningEntriesView } from '../../../../../modules/opening-entries/services';

const initialState: OpeningEntryFormState = {};
const selectClass =
  'h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs aria-invalid:border-danger pointer-coarse:h-row-touch';
const disclosure =
  'cursor-pointer self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3';

type Centres = OpeningEntriesView['centres'];

/**
 * Submits through the action without React's reset after it: a form posted to `action` is reset
 * once the action ends, and a select does not follow its value back (it shows its first option
 * while the screen's state holds another). Kept fields also survive an error this way.
 */
function useSubmit(action: (form: FormData) => void) {
  const [, startTransition] = useTransition();
  return (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    const submitter = event.nativeEvent.submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => {
      action(data);
    });
  };
}

function Select({
  label,
  name,
  value,
  onChange,
  options,
  error,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  error?: string;
  placeholder: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={selectClass}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Close or reopen opening entries; closing is for after go live. */
export function SwitchForm({ open }: { open: boolean }) {
  const [state, action, pending] = useActionState(switchOpeningEntriesAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="opening-switch">
      <input type="hidden" name="open" value={open ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className={`${open ? dangerButtonClass : secondaryButtonClass} md:w-auto md:self-start`}
      >
        {open ? 'Close opening entries' : 'Reopen opening entries'}
      </button>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
    </form>
  );
}

/** A new opening entry: the patient, centre, physio, sessions left and package expiry. */
export function OpeningEntryForm({ centres, today }: { centres: Centres; today: string }) {
  const [state, action, pending] = useActionState(addOpeningEntryAction, initialState);
  // A new form after each entry, so the next starts empty.
  return (
    <EntryForm
      key={state.done ?? 'form'}
      centres={centres}
      today={today}
      state={state}
      action={action}
      pending={pending}
    />
  );
}

function EntryForm({
  centres,
  today,
  state,
  action,
  pending,
}: {
  centres: Centres;
  today: string;
  state: OpeningEntryFormState;
  action: (form: FormData) => void;
  pending: boolean;
}) {
  const submit = useSubmit(action);
  const errors = state.fieldErrors ?? {};
  const [centreId, setCentreId] = useState(centres[0]?.id ?? '');
  const [physioId, setPhysioId] = useState('');
  const physios = centres.find((centre) => centre.id === centreId)?.physios ?? [];
  const matches = state.matches ?? [];
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4"
      noValidate
      data-testid="opening-entry-form"
    >
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.done ? (
        <p role="status" className="text-ink-secondary" data-testid="opening-entry-done">
          {state.done}
        </p>
      ) : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        maxLength={100}

        error={errors.name}
      />
      <TextField
        label="Mobile"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="off"

        error={errors.phone}
      />
      <Select
        label="Centre"
        name="centreId"
        value={centreId}
        onChange={(value) => {
          setCentreId(value);
          setPhysioId('');
        }}
        options={centres}
        error={errors.centreId}
        placeholder="Choose the centre"
      />
      <Select
        label="Physio"
        name="physioId"
        value={physioId}
        onChange={setPhysioId}
        options={physios}
        error={errors.physioId}
        placeholder="Choose the physio"
      />
      <TextField
        label="Sessions left"
        name="sessionsLeft"
        type="number"
        inputMode="numeric"
        min={1}
        max={OPENING_SESSIONS_MAX}

        helper="On the patient's current package; the first session here is Session 1."
        error={errors.sessionsLeft}
      />
      <TextField
        label="Package expiry"
        name="validUntil"
        type="date"
        min={today}

        helper="The last day the package can be used."
        error={errors.validUntil}
      />
      {matches.length > 0 ? (
        <section
          data-testid="phone-matches"
          className="flex flex-col gap-3 rounded-panel border border-waiting-line bg-waiting-soft p-4"
        >
          <h2 className="font-semibold text-ink">This mobile is already on file</h2>
          <ul className="flex flex-col gap-2">
            {matches.map((match) => (
              <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium text-ink">{match.name}</span>{' '}
                  <span className="font-mono text-sm text-ink-secondary">{match.opNumber}</span>
                </span>
                <Link
                  href={`/app/patients/${match.id}`}
                  className="text-accent underline underline-offset-2 pointer-coarse:py-3"
                >
                  Open {match.name}
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="submit"
            name="confirmNewPerson"
            value="true"
            disabled={pending}
            className={secondaryButtonClass}
          >
            {pending ? 'Adding' : 'Add as a new person'}
          </button>
        </section>
      ) : (
        <button
          type="submit"
          disabled={pending}
          className={`${primaryButtonClass} md:w-auto md:self-start`}
        >
          {pending ? 'Adding' : 'Add opening entry'}
        </button>
      )}
    </form>
  );
}

/** One entry, with a correction while its package is unused and entries are open. */
export function OpeningEntryCard({
  entry,
  centres,
  corrects,
  today,
}: {
  entry: OpeningEntryRow;
  centres: Centres;
  corrects: boolean;
  today: string;
}) {
  const [state, action, pending] = useActionState(correctOpeningEntryAction, initialState);
  const submit = useSubmit(action);
  const errors = state.fieldErrors ?? {};
  const physios = centres.find((centre) => centre.id === entry.centreId)?.physios ?? [];
  // A physio no longer treating at the centre is not in the list: nothing is chosen for them.
  const [physioId, setPhysioId] = useState(
    physios.some((physio) => physio.id === entry.physioId) ? entry.physioId : '',
  );
  const used = entry.sessionsUsed ?? 0;
  return (
    <li
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
      data-testid="opening-entry"
      data-patient={entry.patientId}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/app/patients/${entry.patientId}`}
          className="font-medium text-ink underline underline-offset-2"
        >
          {entry.patientName}
        </Link>
        <span className="font-mono text-sm text-ink-secondary">{entry.opNumber}</span>
      </span>
      <span className="text-sm text-ink-secondary" data-testid="opening-entry-summary">
        {entry.centreName} · {entry.physioName} · {entry.sessionsLeft - used} of{' '}
        {entry.sessionsLeft} sessions left · valid until {formatIstDate(entry.validUntil)}
      </span>
      {corrects && used === 0 ? (
        <details className="flex flex-col gap-2">
          <summary className={disclosure}>Correct</summary>
          <form onSubmit={submit} className="mt-2 flex flex-col gap-3" noValidate>
            <input type="hidden" name="entryId" value={entry.id} />
            <Select
              label="Physio"
              name="physioId"
              value={physioId}
              onChange={setPhysioId}
              options={physios}
              error={errors.physioId}
              placeholder="Choose the physio"
            />
            <TextField
              label="Sessions left"
              name="sessionsLeft"
              type="number"
              inputMode="numeric"
              min={1}
              max={OPENING_SESSIONS_MAX}
              defaultValue={String(entry.sessionsLeft)}
              error={errors.sessionsLeft}
            />
            <TextField
              label="Package expiry"
              name="validUntil"
              type="date"
              min={today}
              defaultValue={entry.validUntil}
              error={errors.validUntil}
            />
            <button
              type="submit"
              disabled={pending}
              className={`${secondaryButtonClass} md:w-auto md:self-start`}
            >
              {pending ? 'Saving' : 'Save correction'}
            </button>
            {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
          </form>
        </details>
      ) : null}
    </li>
  );
}
