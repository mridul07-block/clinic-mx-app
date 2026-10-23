import 'server-only';
import {
  checkInView,
  guardiansOf,
  healthFormLink,
  kioskDevices,
  patientReports,
  type CheckInView,
  type GuardianEntry,
  type PatientReportEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  ageOn,
  healthFormState,
  istDate,
  needsGuardian,
  needsHealthForm,
  type HealthFormState,
} from '@clinic-mx/schemas';
import { assertCan, assertMay } from '../access/guard';
import { asStaff } from '../access/staff-db';
import { patientLinkPath } from '../patient-links/services';
import { getSetting } from '../settings/settings';

/** Everything the check in drawer shows (INT-02). */
export interface CheckInDrawerView {
  appointment: CheckInView;
  /** Whole years today, or null without a date of birth. */
  age: number | null;
  /** Under the adult age: their guardians, one of whom must attend (PRD J2.7). */
  minor: boolean;
  guardians: GuardianEntry[];
  /**
   * Null when this visit has no health form (it is part of an open episode). While the patient is
   * still to send it, the page of its link, for the QR.
   */
  healthForm: { state: HealthFormState; expiresAt: Date | null; path: string | null } | null;
  /** Working tablets at the appointment's centre, to open the form on. */
  tablets: { id: string; name: string }[];
  reports: PatientReportEntry[];
}

/**
 * The check in drawer for an appointment (INT-02), for those who check in at its centre, under
 * their row level security; undefined when they cannot see it. The setting is read first.
 */
export async function loadCheckIn(
  actor: StaffMember,
  appointmentId: string,
): Promise<CheckInDrawerView | undefined> {
  assertMay(actor, 'check_in.manage');
  const adultAge = await getSetting('patients.adult_age_years');
  return asStaff(actor, async (tx) => {
    const appointment = await checkInView(tx, appointmentId);
    if (!appointment) return undefined;
    assertCan(actor, 'check_in.manage', { centreId: appointment.centreId });
    const now = new Date();
    const age = appointment.dateOfBirth ? ageOn(appointment.dateOfBirth, istDate(now)) : null;
    const minor = needsGuardian(age, adultAge);
    const latest = await healthFormLink(tx, appointment.id);
    const hasForm = needsHealthForm(appointment, latest);
    const link = hasForm ? latest : undefined;
    const state = healthFormState(link, now, appointment.consentDeclined);
    return {
      appointment,
      age,
      minor,
      guardians: minor ? await guardiansOf(tx, appointment.patientId) : [],
      healthForm: hasForm
        ? {
            state,
            expiresAt: link?.expiresAt ?? null,
            path:
              link && state === 'waiting'
                ? patientLinkPath({ ...link, purpose: 'health_form' })
                : null,
          }
        : null,
      tablets: (await kioskDevices(tx))
        .filter((k) => k.centreId === appointment.centreId && !k.stoppedAt)
        .map((k) => ({ id: k.id, name: k.name })),
      reports: await patientReports(tx, appointment.patientId),
    };
  });
}
