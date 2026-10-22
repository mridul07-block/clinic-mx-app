'use client';

import { formatIndianPhone, patientSexLabels, patientSexes } from '@clinic-mx/schemas';
import Link from 'next/link';
import { useActionState, useId } from 'react';
import {
  FormMessage,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addPatientAction,
  editPatientAction,
  type PatientFormState,
} from '../../../../../modules/patients/actions';

const initialState: PatientFormState = {};

const selectClass =
  'h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs aria-invalid:border-danger pointer-coarse:h-row-touch';

export interface PatientFormValues {
  patientId?: string;
  name: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  sex: string;
  occupation: string;
}

/**
 * A patient's details (SCH-01). A new patient needs a name and a mobile only (Frontend
 * Specification, New booking); the rest waits under "More details" for the health form. A mobile
 * already on file lists its patients: staff open one, or add another person to it.
 */
export function PatientForm({
  patient,
  centres = [],
  today,
}: {
  patient?: PatientFormValues;
  /** For a new patient: the active centres the person registers patients at. */
  centres?: { id: string; name: string }[];
  /** Today in IST, the latest date of birth. */
  today: string;
}) {
  const editing = Boolean(patient?.patientId);
  const [state, action, pending] = useActionState(
    editing ? editPatientAction : addPatientAction,
    initialState,
  );
  const id = useId();
  const errors = state.fieldErrors ?? {};
  const value = (field: keyof PatientFormValues) =>
    state.values?.[field] ??
    (field === 'phone' && patient?.phone ? formatIndianPhone(patient.phone) : patient?.[field]) ??
    '';
  const centreId = state.values?.registeredCentreId ?? centres[0]?.id ?? '';
  const moreGiven = ['email', 'dateOfBirth', 'sex', 'occupation'].some(
    (field) => value(field as keyof PatientFormValues) !== '',
  );
  const matches = state.matches ?? [];

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {patient?.patientId ? (
        <input type="hidden" name="patientId" value={patient.patientId} />
      ) : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="off"
        maxLength={100}
        defaultValue={value('name')}
        error={errors.name}
      />
      <TextField
        label="Mobile"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        defaultValue={value('phone')}
        helper="Family members can share one mobile; each person has their own record."
        error={errors.phone}
      />
      {editing ? null : centres.length === 1 ? (
        <>
          <input type="hidden" name="registeredCentreId" value={centreId} />
          <p className="text-sm text-ink-secondary">
            Registered at {centres[0]?.name}, which issues the OP number.
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-centre`} className="font-medium text-ink">
            Centre
          </label>
          <select
            id={`${id}-centre`}
            name="registeredCentreId"
            defaultValue={centreId}
            aria-invalid={errors.registeredCentreId ? true : undefined}
            aria-describedby={`${id}-centre-helper`}
            className={selectClass}
          >
            {centres.map((centre) => (
              <option key={centre.id} value={centre.id}>
                {centre.name}
              </option>
            ))}
          </select>
          <p id={`${id}-centre-helper`} className="text-sm text-ink-muted">
            The centre registering the patient issues the OP number. It never changes.
          </p>
          {errors.registeredCentreId ? (
            <p className="text-sm text-danger">{errors.registeredCentreId}</p>
          ) : null}
        </div>
      )}
      <details open={moreGiven || undefined} className="flex flex-col gap-4">
        <summary className="cursor-pointer font-medium text-accent pointer-coarse:py-3">
          More details
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <TextField
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            defaultValue={value('email')}
            error={errors.email}
          />
          <TextField
            label="Date of birth"
            name="dateOfBirth"
            type="date"
            max={today}
            defaultValue={value('dateOfBirth')}
            error={errors.dateOfBirth}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-sex`} className="font-medium text-ink">
              Sex
            </label>
            <select
              id={`${id}-sex`}
              name="sex"
              defaultValue={value('sex')}
              aria-invalid={errors.sex ? true : undefined}
              className={selectClass}
            >
              <option value="">Not given</option>
              {patientSexes.map((sex) => (
                <option key={sex} value={sex}>
                  {patientSexLabels[sex]}
                </option>
              ))}
            </select>
            {errors.sex ? <p className="text-sm text-danger">{errors.sex}</p> : null}
          </div>
          <TextField
            label="Occupation"
            name="occupation"
            autoComplete="off"
            maxLength={100}
            defaultValue={value('occupation')}
            error={errors.occupation}
          />
        </div>
      </details>

      {matches.length > 0 ? (
        <section
          aria-labelledby={`${id}-matches`}
          data-testid="phone-matches"
          className="flex flex-col gap-3 rounded-panel border border-waiting-line bg-waiting-soft p-4"
        >
          <h2 id={`${id}-matches`} className="font-semibold text-ink">
            This mobile is already on file
          </h2>
          <p className="text-ink-secondary">
            Open the patient if they are one of these. If not, add them as a new person on the same
            mobile.
          </p>
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
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? 'Saving' : editing ? 'Save details' : 'Add patient'}
        </button>
      )}
    </form>
  );
}
