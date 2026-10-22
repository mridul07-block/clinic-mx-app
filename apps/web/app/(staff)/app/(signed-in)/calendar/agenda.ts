import type { CalendarAppointment, CalendarDay } from '@clinic-mx/db';

const MINUTE = 60_000;

export type AgendaRow =
  | { kind: 'appointment'; appointment: CalendarAppointment; physioName: string }
  | { kind: 'free'; physioId: string; startsAt: Date; endsAt: Date; starts: Date[] }
  | { kind: 'now' };

const startOf = (row: AgendaRow) =>
  row.kind === 'appointment'
    ? row.appointment.startsAt.getTime()
    : row.kind === 'free'
      ? row.startsAt.getTime()
      : 0;

/**
 * The phone agenda's rows (SCH-06), in time order. Everyone (no physio) is every appointment at
 * the centre, then by physio name; one physio's agenda adds their free gaps, each a run of free
 * cells one grid step apart (user decisions, 23 October 2026). Cancelled and rescheduled stay in
 * place, as on the grid. A "now" row sits before the first row that starts later, while now is
 * within the day.
 */
export function agendaRows(
  day: CalendarDay,
  view: { physioId?: string; now: number; step: number },
): AgendaRow[] {
  const columns = view.physioId
    ? day.columns.filter((column) => column.physioId === view.physioId)
    : day.columns;
  const rows: AgendaRow[] = columns.flatMap((column) =>
    column.appointments.map((appointment) => ({
      kind: 'appointment' as const,
      appointment,
      physioName: column.physioName,
    })),
  );
  if (view.physioId) {
    for (const column of columns) {
      let gap: Extract<AgendaRow, { kind: 'free' }> | undefined;
      for (const start of [...column.freeCells].sort((a, b) => a.getTime() - b.getTime())) {
        const endsAt = new Date(start.getTime() + view.step * MINUTE);
        if (gap && gap.endsAt.getTime() === start.getTime()) {
          gap.endsAt = endsAt;
          gap.starts.push(start);
        } else {
          gap = {
            kind: 'free',
            physioId: column.physioId,
            startsAt: start,
            endsAt,
            starts: [start],
          };
          rows.push(gap);
        }
      }
    }
  }
  rows.sort(
    (a, b) =>
      startOf(a) - startOf(b) ||
      (a.kind === 'appointment' && b.kind === 'appointment'
        ? a.physioName.localeCompare(b.physioName)
        : a.kind === 'appointment'
          ? -1
          : 1),
  );

  const span = day.span;
  if (!span || view.now < span.startsAt.getTime() || view.now >= span.endsAt.getTime()) {
    return rows;
  }
  const later = rows.findIndex((row) => startOf(row) > view.now);
  rows.splice(later === -1 ? rows.length : later, 0, { kind: 'now' });
  return rows;
}
