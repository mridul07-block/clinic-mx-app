import type { CalendarDay } from '@clinic-mx/db';

/**
 * The calendar's address carries what it shows (SCH-05): the centre, the date, the physio picked
 * on a phone (SCH-06), and an open appointment or free slot, so links and the browser's back
 * button work without scripts.
 */
export function calendarHref(view: {
  centreId: string;
  date: string;
  physioId?: string;
  appointmentId?: string;
  slot?: { physioId: string; startsAt: Date };
}): string {
  const query = new URLSearchParams({ centre: view.centreId, date: view.date });
  if (view.physioId) query.set('physio', view.physioId);
  if (view.appointmentId) query.set('appointment', view.appointmentId);
  if (view.slot) query.set('slot', `${view.slot.physioId}@${view.slot.startsAt.toISOString()}`);
  return `/app/calendar?${query.toString()}`;
}

/** A free slot picked on the calendar, from the address, or undefined when it is not one. */
export function readSlot(
  value: string | undefined,
): { physioId: string; startsAt: Date } | undefined {
  const [physioId, at] = value?.split('@') ?? [];
  if (!physioId || !at) return undefined;
  const startsAt = new Date(at);
  return Number.isNaN(startsAt.getTime()) ? undefined : { physioId, startsAt };
}

type Json<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Json<T[K]> } : T;

/** The day as the live check sends it (dates as text), and back. */
export type CalendarDayJson = Json<CalendarDay>;

export function reviveDay(json: CalendarDayJson): CalendarDay {
  const span = (s: { startsAt: string; endsAt: string }) => ({
    startsAt: new Date(s.startsAt),
    endsAt: new Date(s.endsAt),
  });
  return {
    span: json.span ? span(json.span) : null,
    columns: json.columns.map((column) => ({
      ...column,
      hours: column.hours.map(span),
      freeCells: column.freeCells.map((cell) => new Date(cell)),
      held: column.held.map(span),
      appointments: column.appointments.map((a) => ({ ...a, ...span(a) })),
    })),
  };
}
