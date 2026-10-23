import 'server-only';
import {
  appointmentRecord,
  checkIn as checkInAppointment,
  checkInView,
  findKioskDevice,
  healthFormLink,
  insertPatientReport,
  sendLinkToKiosk,
  undoCheckIn as undoAppointmentCheckIn,
} from '@clinic-mx/db';
import {
  canCheckIn,
  checkInSchema,
  healthFormState,
  isChangeable,
  needsHealthForm,
  reportExtensions,
  undoCheckInSchema,
  walkInNewPatientSchema,
  walkInSchema,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { assertCan } from '../access/guard';
import { staffService, type ServiceContext, type ServiceTransaction } from '../access/service';
import { issuePatientLink, patientLinkPath, type IssuedLink } from '../patient-links/services';
import {
  SchedulingError,
  addPatientThenBook,
  appointmentTarget,
  bookFor,
  type BookNewPatientResult,
} from '../scheduling/services';
import { getSetting } from '../settings/settings';
import { checkReportFiles, ReportError } from './report-files';
import { reportStore } from './report-store';

export { ReportError };

/**
 * Checks a Booked or Confirmed patient in from the check in drawer (INT-01, INT-02, PRD J2.1):
 * Checked in with the arrival time and who did it, on the appointment's own day, by those who
 * check in at its centre, once they have ticked that they checked who the patient is.
 */
export const checkIn = staffService({
  action: 'check_in.manage',
  input: checkInSchema,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input, actor) => {
    const found = await appointmentRecord(tx, input.appointmentId);
    if (!found || !isChangeable(found.status)) {
      throw new SchedulingError('Only a booked or confirmed appointment is checked in.');
    }
    const now = new Date();
    if (!canCheckIn(found.startsAt, now)) {
      throw new SchedulingError('Check a patient in on the appointment’s day.');
    }
    if (!(await checkInAppointment(tx, { appointmentId: found.id, by: actor.id, now }))) {
      throw new SchedulingError('Only a booked or confirmed appointment is checked in.');
    }
  },
});

/**
 * A walk in (INT-12, user decisions 23 October 2026): a free start today booked as the Walk in
 * channel and checked in, in one transaction, by someone who both books and checks in at the
 * centre, after the identity tick. The slot engine is the booking's (next free start only).
 */
export async function walkIn(context: ServiceContext, rawInput: unknown) {
  const step = await getSetting('scheduling.slot_minutes');
  return staffService({
    action: 'check_in.manage',
    input: walkInSchema,
    target: (input) => Promise.resolve({ centreId: input.centreId }),
    run: async (tx, { identityChecked: _ticked, ...input }, actor) => {
      assertCan(actor, 'bookings.manage', { centreId: input.centreId });
      const now = new Date();
      if (!canCheckIn(input.startsAt, now)) {
        throw new SchedulingError('A walk in is booked for today.');
      }
      const booked = await bookFor(tx, input, actor, { channel: 'walk_in', step, now });
      if (!(await checkInAppointment(tx, { appointmentId: booked.id, by: actor.id, now }))) {
        throw new SchedulingError('The walk in was not checked in.');
      }
      return booked;
    },
  })(context, rawInput);
}

/** A new walk in: added with a name and mobile, then booked and checked in (INT-12). */
export async function addPatientAndWalkIn(
  context: ServiceContext,
  rawInput: unknown,
): Promise<BookNewPatientResult> {
  const { name, phone, confirmNewPerson, ...slot } = walkInNewPatientSchema.parse(rawInput);
  return addPatientThenBook(context, { name, phone, confirmNewPerson, ...slot }, (patientId) =>
    walkIn(context, { ...slot, patientId }),
  );
}

/**
 * Undoes a check in made by mistake (INT-01, user decision 23 October 2026): on the
 * appointment's own day, back to Booked or Confirmed without an arrival time.
 */
export const undoCheckIn = staffService({
  action: 'check_in.manage',
  input: undoCheckInSchema,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input) => {
    const found = await appointmentRecord(tx, input.appointmentId);
    if (!found || found.status !== 'checked_in') {
      throw new SchedulingError('This appointment is not checked in.');
    }
    const now = new Date();
    if (!canCheckIn(found.startsAt, now)) {
      throw new SchedulingError('A check in can only be undone on the appointment’s day.');
    }
    if (!(await undoAppointmentCheckIn(tx, { appointmentId: found.id, now }))) {
      throw new SchedulingError('This appointment is not checked in.');
    }
  },
});

const appointmentInput = z.object({ appointmentId: z.guid() });

/**
 * The appointment's health form link (INT-02, PRD J2.2): the one still waiting, or a new one when
 * none was sent or it ran out. Only for a patient checked in on a first visit for a problem.
 */
async function liveHealthFormLink(
  tx: ServiceTransaction,
  appointmentId: string,
): Promise<IssuedLink & { centreId: string }> {
  const view = await checkInView(tx, appointmentId);
  if (!view || view.status !== 'checked_in') {
    throw new SchedulingError('Check the patient in first.');
  }
  if (!needsHealthForm(view)) {
    throw new SchedulingError('No health form for this visit: it is part of an open episode.');
  }
  const latest = await healthFormLink(tx, appointmentId);
  const state = healthFormState(latest, new Date());
  if (state === 'submitted') {
    throw new SchedulingError('The health form for this visit has been sent already.');
  }
  if (latest && state === 'waiting') {
    const path = patientLinkPath({ ...latest, purpose: 'health_form' });
    if (!path) throw new SchedulingError('Patient links are not set up (PATIENT_LINK_SECRET).');
    return { linkId: latest.id, path, expiresAt: latest.expiresAt, centreId: view.centreId };
  }
  const issued = await issuePatientLink(tx, {
    patientId: view.patientId,
    purpose: 'health_form',
    appointmentId,
  });
  return { ...issued, centreId: view.centreId };
}

/** Show QR (INT-02): the health form link to show as a QR, issued if needed, audited. */
export const showHealthForm = staffService({
  action: 'check_in.manage',
  input: appointmentInput,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: (tx, input) => liveHealthFormLink(tx, input.appointmentId),
});

/**
 * Open on tablet (INT-02, IAM-10): the health form goes to a working kiosk tablet at the
 * appointment's centre, which opens it within a few seconds. The tablet's name, for the message.
 */
export const openFormOnTablet = staffService({
  action: 'check_in.manage',
  input: appointmentInput.extend({ kioskId: z.guid({ error: 'Choose a tablet.' }) }),
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input) => {
    const link = await liveHealthFormLink(tx, input.appointmentId);
    const kiosk = await findKioskDevice(tx, input.kioskId);
    if (!kiosk || kiosk.centreId !== link.centreId) {
      throw new SchedulingError('That tablet is not at this centre.');
    }
    if (kiosk.stoppedAt || !(await sendLinkToKiosk(tx, kiosk.id, link.linkId))) {
      throw new SchedulingError('That tablet is no longer a kiosk.');
    }
    return { tabletName: kiosk.name };
  },
});

/**
 * Add reports (INT-02, TAD section 9): photos (shrunk on the phone first) and PDF scans of the
 * patient's reports, at most `reports.max_file_mb` each. Each file goes to the private `reports`
 * bucket, then a row records it in the audited transaction; if anything fails, the files stored
 * so far are removed again. How many were added.
 */
export async function addReports(
  context: ServiceContext,
  rawInput: { appointmentId: unknown; files: File[] },
): Promise<number> {
  const checked = await checkReportFiles(rawInput.files, await getSetting('reports.max_file_mb'));
  if (checked.length === 0) throw new ReportError('Choose a photo or PDF of the report.');
  const store = reportStore();
  const stored: string[] = [];
  try {
    return await staffService({
      action: 'check_in.manage',
      input: appointmentInput,
      target: (input, tx) => appointmentTarget(tx, input.appointmentId),
      run: async (tx, input, actor) => {
        const view = await checkInView(tx, input.appointmentId);
        if (!view) throw new SchedulingError('That appointment was not found.');
        for (const file of checked) {
          const id = crypto.randomUUID();
          const filePath = `${view.patientId}/${id}.${reportExtensions[file.contentType]}`;
          await store.put(filePath, file.bytes, file.contentType);
          stored.push(filePath);
          await insertPatientReport(tx, {
            id,
            patientId: view.patientId,
            appointmentId: view.id,
            filePath,
            contentType: file.contentType,
            sizeBytes: file.bytes.byteLength,
            uploadedBy: actor.id,
          });
        }
        return checked.length;
      },
    })(context, { appointmentId: rawInput.appointmentId });
  } catch (error) {
    await store.remove(stored);
    throw error;
  }
}
