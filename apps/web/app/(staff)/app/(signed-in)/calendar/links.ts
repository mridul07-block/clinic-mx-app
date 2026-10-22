import type { CalendarDay } from '@clinic-mx/db';

export { calendarHref } from '../../../../../modules/scheduling/links';

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
