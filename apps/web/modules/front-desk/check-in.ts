import 'server-only';
import {
  checkInView,
  guardiansOf,
  healthFormLink,
  kioskDevices,
  patientReports,
  patientUnpaid,
  sessionProgress,
  type CheckInView,
  type GuardianEntry,
  type PatientReportEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  ageOn,
  can,
  formatRupees,
  healthFormState,
  istDate,
  needsGuardian,
  needsHealthForm,
  sessionView,
  ytpFlagged,
  type HealthFormState,
  type SessionView,
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
  /** For a treatment session: "Session n of N" once checked in, and the gate (SES-01). */
  session: SessionView | null;
  /**
   * The patient's unpaid bills (BIL-10), for those who take payment at the centre and only when
   * there are some: a flag above the set number of unpaid sessions, never a block (DECISION #10).
   */
  unpaid: { sessions: number; amount: string; flagged: boolean; flagAbove: number } | null;
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
  const flagAbove = await getSetting('billing.unpaid_sessions_flag_above');
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
    const owed = can(actor, 'bills.create_and_collect', { centreId: appointment.centreId })
      ? await patientUnpaid(tx, appointment.patientId)
      : undefined;
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
      session: sessionView((await sessionProgress(tx, [appointment.id])).get(appointment.id)),
      unpaid:
        owed && owed.unpaidBills > 0
          ? {
              sessions: owed.unpaidSessions,
              amount: formatRupees(owed.unpaidPaise),
              flagged: ytpFlagged(owed.unpaidSessions, flagAbove),
              flagAbove,
            }
          : null,
    };
  });
}
