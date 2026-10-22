import type { CalendarDay } from '@clinic-mx/db';
import { formatRupees, overlaps } from '@clinic-mx/schemas';
import Link from 'next/link';
import { Tag } from '../../../../../components/tag';
import { CalendarBlock, shownStatus, timeOf } from './calendar-block';
import { calendarHref } from './links';

const MINUTE = 60_000;

/** The minute past the hour in IST, for the hour and half hour lines. */
const minuteOf = (instant: Date) => Number(timeOf(instant).slice(3));

/**
 * The day grid (SCH-05, design system "Calendar block" and grid): a time column and a column per
 * physio with their name, Consultant tag and fee in a sticky header; rows on the slot grid, solid
 * on the hour and dotted on the half hour; free cells link to the slot drawer ("+ 10:30" on hover);
 * time outside their hours is sunken; holds by others read "Being booked"; a "now" line with its
 * time. The grid scrolls inside its panel, never the page.
 */
export function DayGrid({
  day,
  centreId,
  date,
  step,
  now,
  lateMinutes,
  selectedAppointment,
}: {
  day: CalendarDay;
  centreId: string;
  date: string;
  step: number;
  now: number;
  lateMinutes: number;
  selectedAppointment?: string;
}) {
  const span = day.span;
  if (!span) return null;
  const start = span.startsAt.getTime();
  const rows = Math.round((span.endsAt.getTime() - start) / (step * MINUTE));
  const rowOf = (instant: Date) => Math.round((instant.getTime() - start) / (step * MINUTE)) + 2;
  const nowRow = (now - start) / (step * MINUTE);
  const showNow = nowRow >= 0 && nowRow < rows;

  return (
    <div
      className="max-h-[calc(100dvh-11rem)] overflow-auto rounded-panel border border-line bg-surface shadow-xs"
      data-testid="calendar-grid"
    >
      <div
        className="grid min-w-max"
        style={{
          gridTemplateColumns: `4rem repeat(${String(day.columns.length)}, minmax(11rem, 1fr))`,
          gridTemplateRows: `auto repeat(${String(rows)}, 1.5rem)`,
        }}
      >
        <div className="sticky top-0 left-0 z-30 border-b border-line bg-surface" />
        {day.columns.map((column, index) => (
          <div
            key={column.physioId}
            role="columnheader"
            data-testid="physio-column"
            className="sticky top-0 z-20 flex flex-col gap-1 border-b border-l border-line bg-surface px-3 py-2"
            style={{ gridColumn: index + 2, gridRow: 1 }}
          >
            <span className="font-semibold text-ink">{column.physioName}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-ink-secondary">
              {column.consultant ? <Tag tone="outline">Consultant</Tag> : null}
              {column.fee ? (
                <span data-testid="physio-fee">
                  {column.fee.label}{' '}
                  <span className="tabular-nums">{formatRupees(column.fee.amountPaise)}</span>
                </span>
              ) : null}
            </span>
          </div>
        ))}

        {Array.from({ length: rows }, (_, row) => {
          const at = new Date(start + row * step * MINUTE);
          const minute = minuteOf(at);
          return (
            <div
              key={row}
              className={`sticky left-0 z-10 bg-surface pr-2 text-right text-xs text-ink-muted tabular-nums ${
                minute === 0 ? 'border-t border-line' : ''
              }`}
              style={{ gridColumn: 1, gridRow: row + 2 }}
            >
              {minute === 0 || minute === 30 ? timeOf(at) : ''}
            </div>
          );
        })}

        {day.columns.map((column, index) => {
          const free = new Set(column.freeCells.map((cell) => cell.getTime()));
          return Array.from({ length: rows }, (_, row) => {
            const at = new Date(start + row * step * MINUTE);
            const cell = { startsAt: at, endsAt: new Date(at.getTime() + step * MINUTE) };
            const minute = minuteOf(at);
            const line =
              minute === 0
                ? 'border-t border-line'
                : minute === 30
                  ? 'border-t border-dotted border-line'
                  : '';
            const working = column.hours.some((hours) => overlaps(cell, hours));
            const place = { gridColumn: index + 2, gridRow: row + 2 };
            if (free.has(at.getTime())) {
              return (
                <Link
                  key={`${column.physioId}-${String(row)}`}
                  href={calendarHref({
                    centreId,
                    date,
                    slot: { physioId: column.physioId, startsAt: at },
                  })}
                  scroll={false}
                  aria-label={`Free at ${timeOf(at)} with ${column.physioName}`}
                  data-testid="free-cell"
                  className={`group flex items-center border-l border-line px-2 text-xs text-ink-muted hover:bg-surface-hover ${line}`}
                  style={place}
                >
                  <span className="hidden group-hover:inline group-focus-visible:inline">
                    + {timeOf(at)}
                  </span>
                </Link>
              );
            }
            return (
              <div
                key={`${column.physioId}-${String(row)}`}
                className={`border-l border-line ${working ? '' : 'bg-surface-sunken'} ${line}`}
                style={place}
              />
            );
          });
        })}

        {day.columns.map((column, index) =>
          column.held.map((hold) => (
            <div
              key={`${column.physioId}@${hold.startsAt.toISOString()}`}
              className="z-[5] m-0.5 flex items-start rounded-control border border-dashed border-line-strong bg-surface-sunken px-2 py-0.5 text-xs text-ink-secondary"
              style={{
                gridColumn: index + 2,
                gridRow: `${String(rowOf(hold.startsAt))} / ${String(rowOf(hold.endsAt))}`,
              }}
            >
              Being booked
            </div>
          )),
        )}

        {day.columns.map((column, index) =>
          column.appointments.map((appointment) => {
            const status = shownStatus(appointment, now, lateMinutes);
            const freed = status === 'cancelled' || status === 'rescheduled';
            // A freed block shares its time with whatever was booked there since: half each.
            const shared = column.appointments.some(
              (other) =>
                other.id !== appointment.id &&
                (other.status === 'cancelled' || other.status === 'rescheduled') !== freed &&
                overlaps(other, appointment),
            );
            return (
              <div
                key={appointment.id}
                className={`z-[6] p-0.5 ${shared ? (freed ? 'mr-[50%]' : 'ml-[50%]') : ''}`}
                style={{
                  gridColumn: index + 2,
                  gridRow: `${String(rowOf(appointment.startsAt))} / ${String(rowOf(appointment.endsAt))}`,
                }}
              >
                <CalendarBlock
                  appointment={appointment}
                  status={status}
                  selected={selectedAppointment === appointment.id}
                  href={calendarHref({ centreId, date, appointmentId: appointment.id })}
                />
              </div>
            );
          }),
        )}

        {showNow ? (
          <div
            aria-hidden="true"
            className="pointer-events-none relative z-[7]"
            style={{ gridColumn: '1 / -1', gridRow: Math.floor(nowRow) + 2 }}
          >
            <div
              data-testid="now-line"
              className="absolute inset-x-0 flex items-center"
              style={{ top: `${String((nowRow % 1) * 100)}%` }}
            >
              <span className="w-16 bg-surface pr-1 text-right text-xs font-medium text-accent tabular-nums">
                {timeOf(new Date(now))}
              </span>
              <span className="h-0.5 flex-1 bg-accent" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
