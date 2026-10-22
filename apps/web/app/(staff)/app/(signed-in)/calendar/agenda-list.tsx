import type { CalendarDay } from '@clinic-mx/db';
import { formatRupees } from '@clinic-mx/schemas';
import { toneByAppointmentStatus } from '@clinic-mx/ui';
import Link from 'next/link';
import { Tag } from '../../../../../components/tag';
import { agendaRows } from './agenda';
import { shownStatus, shownStatusLabels, stripClass, timeOf } from './calendar-block';
import { calendarHref } from './links';

const chipClass =
  'inline-flex min-h-11 shrink-0 items-center rounded-control border px-3 text-sm whitespace-nowrap';

/**
 * The phone agenda (SCH-06, Frontend Specification "Calendar … phone: agenda per physio"): one
 * list at a time. Everyone by time is the default; a chip picks one physio, whose agenda adds
 * their free gaps with a 44 px chip for each start (user decisions, 23 October 2026). A physio
 * has only their own column, so only their agenda. Details open in the bottom sheet.
 */
export function AgendaList({
  day,
  centreId,
  date,
  physioId,
  step,
  now,
  lateMinutes,
  selectedAppointment,
}: {
  day: CalendarDay;
  centreId: string;
  date: string;
  physioId?: string;
  step: number;
  now: number;
  lateMinutes: number;
  selectedAppointment?: string;
}) {
  const only = day.columns.length === 1 ? day.columns[0] : undefined;
  const chosen = only ?? day.columns.find((column) => column.physioId === physioId);
  const rows = agendaRows(day, { physioId: chosen?.physioId, now, step });
  const pick = chosen?.physioId;

  return (
    <div className="flex flex-col gap-3" data-testid="agenda">
      {only ? null : (
        <nav aria-label="Physio" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {[{ physioId: undefined, physioName: 'Everyone' }, ...day.columns].map((column) => (
            <Link
              key={column.physioId ?? 'everyone'}
              href={calendarHref({ centreId, date, physioId: column.physioId })}
              scroll={false}
              aria-current={column.physioId === pick ? 'page' : undefined}
              className={`${chipClass} ${
                column.physioId === pick
                  ? 'border-ink bg-surface font-medium text-ink'
                  : 'border-line-control text-ink-secondary'
              }`}
            >
              {column.physioName}
            </Link>
          ))}
        </nav>
      )}

      {chosen ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-md font-semibold text-ink">{chosen.physioName}</h2>
          <span className="flex flex-wrap items-center gap-1.5 text-sm text-ink-secondary">
            {chosen.consultant ? <Tag tone="outline">Consultant</Tag> : null}
            {chosen.fee ? (
              <span>
                {chosen.fee.label}{' '}
                <span className="tabular-nums">{formatRupees(chosen.fee.amountPaise)}</span>
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface px-4 py-3 text-ink-secondary">
          {chosen ? 'No free time or appointments this day.' : 'No appointments this day.'}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface shadow-xs">
          {rows.map((row) => {
            if (row.kind === 'now') {
              return (
                <li key="now" aria-label="Now" className="flex items-center gap-2 px-4 py-1">
                  <span className="text-xs font-medium text-accent tabular-nums">
                    {timeOf(new Date(now))}
                  </span>
                  <span className="h-0.5 flex-1 bg-accent" />
                </li>
              );
            }
            if (row.kind === 'free') {
              const physioName = chosen?.physioName ?? '';
              return (
                <li
                  key={`free@${row.startsAt.toISOString()}`}
                  className="flex flex-col gap-2 px-4 py-3"
                >
                  <span className="text-sm text-ink-secondary tabular-nums">
                    Free {timeOf(row.startsAt)} to {timeOf(row.endsAt)}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {row.starts.map((start) => (
                      <Link
                        key={start.toISOString()}
                        href={calendarHref({
                          centreId,
                          date,
                          physioId: row.physioId,
                          slot: { physioId: row.physioId, startsAt: start },
                        })}
                        scroll={false}
                        aria-label={`Free at ${timeOf(start)} with ${physioName}`}
                        data-testid="agenda-free"
                        className={`${chipClass} border-line-control text-ink tabular-nums`}
                      >
                        {timeOf(start)}
                      </Link>
                    ))}
                  </span>
                </li>
              );
            }
            const { appointment } = row;
            const status = shownStatus(appointment, now, lateMinutes);
            const freed = status === 'cancelled' || status === 'rescheduled';
            return (
              <li key={appointment.id}>
                <Link
                  href={calendarHref({
                    centreId,
                    date,
                    physioId: pick,
                    appointmentId: appointment.id,
                  })}
                  scroll={false}
                  data-testid="agenda-row"
                  aria-current={selectedAppointment === appointment.id ? 'true' : undefined}
                  className={`relative flex min-h-11 items-start gap-3 py-3 pr-4 pl-5 aria-[current=true]:bg-surface-hover ${
                    freed ? 'cmx-hatch' : ''
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 w-[3px] ${stripClass[toneByAppointmentStatus[status]]}`}
                  />
                  <span
                    className={`w-12 shrink-0 text-sm text-ink tabular-nums ${freed ? 'line-through' : ''}`}
                  >
                    {timeOf(appointment.startsAt)}
                    <span className="block text-xs text-ink-muted">
                      {timeOf(appointment.endsAt)}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium text-ink">{appointment.patientName}</span>
                    <span className="truncate text-sm text-ink-secondary">
                      {appointment.typeName}
                      {chosen ? '' : ` · ${row.physioName}`}
                      {appointment.machineUnit
                        ? ` · Treadmill ${String(appointment.machineUnit)}`
                        : ''}
                    </span>
                  </span>
                  <span className="shrink-0">
                    <Tag tone={toneByAppointmentStatus[status]}>{shownStatusLabels[status]}</Tag>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
