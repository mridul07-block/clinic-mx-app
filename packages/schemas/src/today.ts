import { z } from 'zod';
import { istDate } from './ist';
import type { AppointmentStatus } from './slots';

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

export const checkInSchema = z.object({ appointmentId: z.guid() });

export const undoCheckInSchema = z.object({ appointmentId: z.guid() });
