import { z } from 'zod';
import { istDate } from './ist';
import { bookNewPatientSchema } from './calendar';
import { bookSlotSchema, type AppointmentStatus } from './slots';

/**
 * The front desk Today board (INT-01, Frontend Specification "Front Desk"): count chips that
 * filter To arrive, Here now, With physio and Done. Cancelled and Rescheduled are left off the
 * board; Done is Completed and No show (user decision, 23 October 2026).
 */
export const todayGroups = ['to_arrive', 'here', 'with_physio', 'done'] as const;

export type TodayGroup = (typeof todayGroups)[number];

export const todayGroupLabels = {
  to_arrive: 'To arrive',
  here: 'Here now',
  with_physio: 'With physio',
  done: 'Done',
} as const satisfies Record<TodayGroup, string>;

/** The chip an appointment counts under; undefined for one left off the board. */
export function todayGroup(status: AppointmentStatus): TodayGroup | undefined {
  switch (status) {
    case 'booked':
    case 'confirmed':
      return 'to_arrive';
    case 'checked_in':
      return 'here';
    case 'in_progress':
      return 'with_physio';
    case 'completed':
    case 'no_show':
      return 'done';
    case 'cancelled':
    case 'rescheduled':
      return undefined;
  }
}

/** The board's chips: the four groups, and Booked (not confirmed) still to arrive. */
export const todayFilters = [...todayGroups, 'not_confirmed'] as const;

export type TodayFilter = (typeof todayFilters)[number];

export const todayFilterLabels = {
  ...todayGroupLabels,
  not_confirmed: 'Not confirmed',
} as const satisfies Record<TodayFilter, string>;

/** Whether an appointment shows under a chip; every one on the board shows under none. */
export function inTodayFilter(status: AppointmentStatus, filter: TodayFilter | undefined): boolean {
  if (filter === undefined) return todayGroup(status) !== undefined;
  return filter === 'not_confirmed' ? status === 'booked' : todayGroup(status) === filter;
}

/**
 * PRD J2.1: the front desk checks a Booked or Confirmed patient in on the appointment's own day,
 * in IST; a check in made by mistake is undone on that day too (user decision, 23 October 2026).
 */
export function canCheckIn(startsAt: Date, now: Date): boolean {
  return istDate(startsAt) === istDate(now);
}

/** Check in (INT-02): the desk ticks that it has checked who the patient is (user decision). */
/** The desk has checked who this is, name and date of birth, before checking in (INT-02). */
const identityChecked = z.literal(true, { error: 'Tick that you have checked who this is.' });

export const checkInSchema = z.object({ appointmentId: z.guid(), identityChecked });

/**
 * A walk in (INT-12, user decisions 23 October 2026): a free start today booked and checked in in
 * one action, as the Walk in channel, after the same identity tick; for a patient on file, or
 * added with a name and mobile.
 */
export const walkInSchema = bookSlotSchema.extend({ identityChecked });

export const walkInNewPatientSchema = bookNewPatientSchema.extend({ identityChecked });

export const undoCheckInSchema = z.object({ appointmentId: z.guid() });

/**
 * The health form is for a first visit for a problem: an appointment with no episode yet (user
 * decision, 23 October 2026); submitting it creates the episode (INT-10).
 */
export function needsHealthForm(appointment: { episodeId: string | null }): boolean {
  return appointment.episodeId === null;
}

export const healthFormStates = [
  'not_sent',
  'waiting',
  'submitted',
  'expired',
  'declined',
] as const;

export type HealthFormState = (typeof healthFormStates)[number];

export const healthFormStateLabels = {
  not_sent: 'Not sent',
  waiting: 'Waiting for the patient',
  submitted: 'Submitted',
  expired: 'Link expired',
  declined: 'Consent declined',
} as const satisfies Record<HealthFormState, string>;

/**
 * Where an appointment's health form stands, from its latest link (none: not sent); a Part A
 * consent declined (INT-06) shows until the patient changes their mind, so reception can speak
 * to them.
 */
export function healthFormState(
  link: { expiresAt: Date; revokedAt: Date | null; completedAt: Date | null } | undefined,
  now: Date,
  consentDeclined = false,
): HealthFormState {
  if (!link) return 'not_sent';
  if (link.completedAt) return 'submitted';
  if (consentDeclined) return 'declined';
  if (link.revokedAt || link.expiresAt <= now) return 'expired';
  return 'waiting';
}

/**
 * A health form link opens only while its visit is on: Checked in or In consultation (INT-03,
 * user decision, 23 October 2026). Cancelled, rescheduled, no show, finished or a check in undone
 * closes it; checking in again opens the same link again.
 */
export const healthFormOpenStatuses = [
  'checked_in',
  'in_progress',
] as const satisfies readonly AppointmentStatus[];

export function healthFormOpen(status: AppointmentStatus): boolean {
  return (healthFormOpenStatuses as readonly AppointmentStatus[]).includes(status);
}

/** The first word of a name, for "Hello <first name>" on patient pages; the rest stays off. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** What a report can be (TAD: photos and scans): photos are shrunk to JPEG on the phone first. */
export const reportContentTypes = ['image/jpeg', 'image/png', 'application/pdf'] as const;

export type ReportContentType = (typeof reportContentTypes)[number];

export const reportExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
} as const satisfies Record<ReportContentType, string>;

/** The most a hosted function takes in one request is 4.5 MB, so a file is at most 4 MB. */
export const reportMaxMegabytesCeiling = 4;
