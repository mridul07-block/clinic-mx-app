'use server';

import { SlotRefusedError, type PatientMatch } from '@clinic-mx/db';
import { istDate } from '@clinic-mx/schemas';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { todayHref } from '../front-desk/links';
import { addPatientAndWalkIn, walkIn } from '../front-desk/services';
import { PatientError } from '../patients/services';
import { calendarHref } from './links';
import {
  SchedulingError,
  addPatientAndBook,
  bookSlot,
  cancelAppointment,
  holdSlot,
  liftSelfBookingBlock,
  markNoShow,
  releaseSlot,
  rescheduleAppointment,
  undoNoShow,
} from './services';

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

/** Rescheduling this appointment (SCH-08), when the hold is for a move. */
const freeingFrom = (form: FormData) => text(form, 'freeing') || undefined;

/** The calendar day of a start, for where to go next; today when it cannot be read. */
const dayOf = (startsAt: string) => {
  const instant = new Date(startsAt);
  return istDate(Number.isNaN(instant.getTime()) ? new Date() : instant);
};

/** The physio picked on a phone, kept across the booking (SCH-06). */
const viewFrom = (form: FormData) => text(form, 'view') || undefined;

/** A walk in (INT-12): book and check in, after the identity tick. */
const walkInFrom = (form: FormData) => text(form, 'walkIn') === '1';
const identityFrom = (form: FormData) => text(form, 'identityChecked') === 'true';

/** After a walk in: the check in drawer on Today, for the form and reports (INT-12). */
const walkedInHref = (form: FormData, appointmentId: string) =>
  todayHref({ centreId: choiceFrom(form).centreId, appointmentId, done: 'checked-in' });

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): BookingFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(-1) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    // A walk in's identity tick (INT-12) sits outside the fields: its message is the form's.
    const only = Object.keys(fieldErrors);
    if (only.length === 1 && fieldErrors.identityChecked) {
      return { error: fieldErrors.identityChecked };
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
  const freeing = freeingFrom(form);
  try {
    await holdSlot(await serviceContext(), { ...choice, freeing });
  } catch (error) {
    return failure(error);
  }
  if (freeing) {
    // A move: back to the appointment being moved, on its own day, at the confirm step.
    redirect(
      calendarHref({
        centreId: choice.centreId,
        date: text(form, 'date'),
        physioId: viewFrom(form),
        appointmentId: freeing,
        change: 'reschedule',
        book: { ...choice, startsAt: new Date(choice.startsAt) },
      }),
    );
  }
  redirect(
    calendarHref({
      centreId: choice.centreId,
      date: dayOf(choice.startsAt),
      physioId: viewFrom(form),
      book: { ...choice, startsAt: new Date(choice.startsAt) },
      walkIn: walkInFrom(form),
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
  if (walkInFrom(form)) redirect(todayHref({ centreId }));
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
  const walkingIn = walkInFrom(form);
  try {
    const input = { ...choiceFrom(form), patientId: text(form, 'patientId') };
    const booked = walkingIn
      ? await walkIn(await serviceContext(), { ...input, identityChecked: identityFrom(form) })
      : await bookSlot(await serviceContext(), input);
    appointmentId = booked.id;
  } catch (error) {
    return failure(error);
  }
  redirect(walkingIn ? walkedInHref(form, appointmentId) : bookedHref(form, appointmentId));
}

/** Adds a caller or walk in with a name and mobile, then books the held start for them. */
export async function addPatientAndBookAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const values = { name: text(form, 'name'), phone: text(form, 'phone') };
  let appointmentId: string;
  const walkingIn = walkInFrom(form);
  try {
    const input = {
      ...choiceFrom(form),
      ...values,
      confirmNewPerson: text(form, 'confirmNewPerson') === 'true',
    };
    const result = walkingIn
      ? await addPatientAndWalkIn(await serviceContext(), {
          ...input,
          identityChecked: identityFrom(form),
        })
      : await addPatientAndBook(await serviceContext(), input);
    if (result.status === 'matches') return { matches: result.matches, values };
    appointmentId = result.id;
  } catch (error) {
    return { ...failure(error), values };
  }
  redirect(walkingIn ? walkedInHref(form, appointmentId) : bookedHref(form, appointmentId));
}

/** Cancels the open appointment, recording who asked (SCH-08); then shows it, cancelled. */
export async function cancelAppointmentAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const appointmentId = text(form, 'appointmentId');
  try {
    await cancelAppointment(await serviceContext(), {
      appointmentId,
      reason: text(form, 'reason'),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(
    calendarHref({
      centreId: text(form, 'centreId'),
      date: text(form, 'date'),
      physioId: viewFrom(form),
      appointmentId,
    }),
  );
}

/** Moves the open appointment to the held start (SCH-08); then shows the new one. */
export async function rescheduleAppointmentAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const startsAt = text(form, 'startsAt');
  let appointmentId: string;
  try {
    const moved = await rescheduleAppointment(await serviceContext(), {
      appointmentId: text(form, 'appointmentId'),
      physioId: text(form, 'physioId'),
      startsAt,
      reason: text(form, 'reason'),
    });
    appointmentId = moved.id;
  } catch (error) {
    return failure(error);
  }
  redirect(
    calendarHref({
      centreId: text(form, 'centreId'),
      // Everyone on a phone: the new appointment may be with another physio.
      date: dayOf(startsAt),
      appointmentId,
      moved: true,
    }),
  );
}

/** "Allow self booking again" on the patient's page (SCH-09). */
export async function liftSelfBookingBlockAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const patientId = text(form, 'patientId');
  try {
    await liftSelfBookingBlock(await serviceContext(), { patientId });
  } catch (error) {
    return failure(error);
  }
  redirect(`/app/patients/${patientId}?done=self-booking`);
}

/** The open appointment on the calendar, after a no show is marked or undone (INT-11). */
const backToAppointment = (form: FormData, appointmentId: string) =>
  calendarHref({
    centreId: text(form, 'centreId'),
    date: text(form, 'date'),
    physioId: viewFrom(form),
    appointmentId,
  });

/** Marks the open appointment a no show (INT-11); then shows it. */
export async function markNoShowAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const appointmentId = text(form, 'appointmentId');
  try {
    await markNoShow(await serviceContext(), { appointmentId });
  } catch (error) {
    return failure(error);
  }
  redirect(backToAppointment(form, appointmentId));
}

/** Undoes a no show marked by mistake (INT-11); then shows the appointment. */
export async function undoNoShowAction(
  _state: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const appointmentId = text(form, 'appointmentId');
  try {
    await undoNoShow(await serviceContext(), { appointmentId });
  } catch (error) {
    return failure(error);
  }
  redirect(backToAppointment(form, appointmentId));
}
