'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { PatientLinkError } from '../patient-links/services';
import { SchedulingError } from '../scheduling/services';
import { todayHref, type CheckInDone } from './links';
import {
  ReportError,
  addReports,
  checkIn,
  fillInWithPatient,
  openFormOnTablet,
  showHealthForm,
  undoCheckIn,
} from './services';

/** What a Today board or check in drawer form shows after a post (INT-01, INT-02). */
export interface TodayFormState {
  error?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals become messages; anything else is ours and is thrown. */
function failure(error: unknown): TodayFormState {
  if (error instanceof z.ZodError) {
    return { error: error.issues[0]?.message ?? 'That could not be read.' };
  }
  if (
    error instanceof SchedulingError ||
    error instanceof ReportError ||
    error instanceof PatientLinkError ||
    error instanceof ReadOnlyError
  ) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) return { error: 'You cannot check in at that centre.' };
  throw error;
}

/** Back to the board as it was (its centre and chip), with the drawer open after a change. */
const back = (form: FormData, extra: { qr?: boolean; done?: CheckInDone } = {}) =>
  todayHref({
    centreId: text(form, 'centreId'),
    show: text(form, 'show') || undefined,
    appointmentId: text(form, 'appointmentId'),
    ...extra,
  });

/** Checks the patient in once their identity is ticked (INT-01, INT-02); the drawer again. */
export async function checkInAction(
  _state: TodayFormState,
  form: FormData,
): Promise<TodayFormState> {
  try {
    await checkIn(await serviceContext(), {
      appointmentId: text(form, 'appointmentId'),
      identityChecked: form.get('identityChecked') === 'on' ? true : undefined,
    });
  } catch (error) {
    return failure(error);
  }
  redirect(back(form, { done: 'checked-in' }));
}

/** Undoes a check in made by mistake (INT-01); the drawer again. */
export async function undoCheckInAction(
  _state: TodayFormState,
  form: FormData,
): Promise<TodayFormState> {
  try {
    await undoCheckIn(await serviceContext(), { appointmentId: text(form, 'appointmentId') });
  } catch (error) {
    return failure(error);
  }
  redirect(back(form, { done: 'undone' }));
}

/** Show QR (INT-02): makes sure the health form link exists, then shows it as a QR. */
export async function showQrAction(
  _state: TodayFormState,
  form: FormData,
): Promise<TodayFormState> {
  try {
    await showHealthForm(await serviceContext(), { appointmentId: text(form, 'appointmentId') });
  } catch (error) {
    return failure(error);
  }
  redirect(back(form, { qr: true }));
}

/** Fill in with the patient (INT-09): the helper is recorded; the drawer offers the form. */
export async function fillInAction(
  _state: TodayFormState,
  form: FormData,
): Promise<TodayFormState> {
  try {
    await fillInWithPatient(await serviceContext(), { appointmentId: text(form, 'appointmentId') });
  } catch (error) {
    return failure(error);
  }
  redirect(back(form, { done: 'assisted' }));
}

/** Open on tablet (INT-02): the health form goes to the chosen tablet. */
export async function openOnTabletAction(
  _state: TodayFormState,
  form: FormData,
): Promise<TodayFormState> {
  try {
    await openFormOnTablet(await serviceContext(), {
      appointmentId: text(form, 'appointmentId'),
      kioskId: text(form, 'kioskId'),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(back(form, { done: 'tablet' }));
}

/** Add reports (INT-02): the files posted, already shrunk on the device. */
export async function addReportsAction(
  _state: TodayFormState,
  form: FormData,
): Promise<TodayFormState> {
  try {
    await addReports(await serviceContext(), {
      appointmentId: text(form, 'appointmentId'),
      files: form.getAll('reports').filter((value): value is File => value instanceof File),
    });
  } catch (error) {
    return failure(error);
  }
  redirect(back(form, { done: 'reports' }));
}
