'use server';

import { SlotRefusedError, type PatientMatch } from '@clinic-mx/db';
import { istDate } from '@clinic-mx/schemas';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { PatientError } from '../patients/services';
import { calendarHref } from './links';
import { SchedulingError, addPatientAndBook, bookSlot, holdSlot, releaseSlot } from './services';

/** What a booking form shows after a post (SCH-07). */
export interface BookingFormState {
  error?: string;
  /** Messages by field: name, phone. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error or the matches so the form keeps it. */
  values?: Record<string, string>;
  /** Patients already on the mobile typed; staff book one or confirm a new person. */
  matches?: PatientMatch[];
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** The start the form is about: its centre, physio, type and time. */
const choiceFrom = (form: FormData) => ({
  centreId: text(form, 'centreId'),
  physioId: text(form, 'physioId'),
  appointmentTypeId: text(form, 'appointmentTypeId'),
  startsAt: text(form, 'startsAt'),
});

/** The calendar day of a start, for where to go next; today when it cannot be read. */
const dayOf = (startsAt: string) => {
  const instant = new Date(startsAt);
  return istDate(Number.isNaN(instant.getTime()) ? new Date() : instant);
};

/** The physio picked on a phone, kept across the booking (SCH-06). */
const viewFrom = (form: FormData) => text(form, 'view') || undefined;

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): BookingFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (
    error instanceof SlotRefusedError ||
    error instanceof SchedulingError ||
    error instanceof PatientError ||
    error instanceof ReadOnlyError
  ) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'You cannot book at that centre.' };
  }
  throw error;
}

/** Holds a start for the person (SCH-07), then opens the booking sheet for it. */
export async function holdSlotAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const choice = choiceFrom(form);
  try {
    await holdSlot(await serviceContext(), choice);
  } catch (error) {
    return failure(error);
  }
  redirect(
    calendarHref({
      centreId: choice.centreId,
      date: dayOf(choice.startsAt),
      physioId: viewFrom(form),
      book: { ...choice, startsAt: new Date(choice.startsAt) },
    }),
  );
}

/** Cancel on the booking sheet: gives the hold back and returns to the plain day. */
export async function releaseSlotAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const centreId = text(form, 'centreId');
  try {
    await releaseSlot(await serviceContext(), { centreId });
  } catch (error) {
    return failure(error);
  }
  redirect(calendarHref({ centreId, date: text(form, 'date'), physioId: viewFrom(form) }));
}

const bookedHref = (form: FormData, appointmentId: string) => {
  const choice = choiceFrom(form);
  return calendarHref({
    centreId: choice.centreId,
    date: dayOf(choice.startsAt),
    physioId: viewFrom(form),
    appointmentId,
    booked: true,
  });
};

/** Books the held start for a patient found by search, then shows the new appointment. */
export async function bookSlotAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  let appointmentId: string;
  try {
    const booked = await bookSlot(await serviceContext(), {
      ...choiceFrom(form),
      patientId: text(form, 'patientId'),
    });
    appointmentId = booked.id;
  } catch (error) {
    return failure(error);
  }
  redirect(bookedHref(form, appointmentId));
}

/** Adds a caller or walk in with a name and mobile, then books the held start for them. */
export async function addPatientAndBookAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const values = { name: text(form, 'name'), phone: text(form, 'phone') };
  let appointmentId: string;
  try {
    const result = await addPatientAndBook(await serviceContext(), {
      ...choiceFrom(form),
      ...values,
      confirmNewPerson: text(form, 'confirmNewPerson') === 'true',
    });
    if (result.status === 'matches') return { matches: result.matches, values };
    appointmentId = result.id;
  } catch (error) {
    return { ...failure(error), values };
  }
  redirect(bookedHref(form, appointmentId));
}
