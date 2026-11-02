'use client';

import type { TodayAppointment } from '@clinic-mx/db';
import type { SessionView } from '@clinic-mx/schemas';
import {
  formatRupees,
  inTodayFilter,
  todayFilterLabels,
  todayFilters,
  type TodayFilter,
} from '@clinic-mx/schemas';
import { toneByAppointmentStatus } from '@clinic-mx/ui';
import { CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { primaryButtonClass, secondaryButtonClass } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { LIVE_HEADER } from '../../../../../lib/live';
import { todayHref } from '../../../../../modules/front-desk/links';
import { calendarHref } from '../../../../../modules/scheduling/links';
import { shownStatus, shownStatusLabels, stripClass, timeOf } from '../calendar/calendar-block';
import { scheduleLiveChecks } from '../../../../../lib/live-relay';
import { useLiveRelay } from '../../../../../lib/live-relay-context';

/** A Today row with its session (SES-01). */
type TodayRow = TodayAppointment & {
  session: SessionView | null;
  unpaidFlagAbove: number | null;
};

const matches = (appointment: TodayRow, filter: TodayFilter | undefined) =>
  inTodayFilter(appointment.status, filter);

type TodayJson = {
  [K in keyof TodayRow]: TodayRow[K] extends Date
    ? string
    : TodayRow[K] extends Date | null
      ? string | null
      : TodayRow[K];
};

const revive = (a: TodayJson): TodayRow => ({
  ...a,
  startsAt: new Date(a.startsAt),
  endsAt: new Date(a.endsAt),
  confirmedAt: a.confirmedAt ? new Date(a.confirmedAt) : null,
  arrivedAt: a.arrivedAt ? new Date(a.arrivedAt) : null,
});

/** A row's action: as wide as its words, not the row. */
const fit = (buttonClass: string) => `${buttonClass.replace('w-full', 'w-auto')} shrink-0`;

const minutesSince = (from: Date, now: number) =>
  Math.max(0, Math.floor((now - from.getTime()) / 60_000));

// Count chips that are also the filters (design system v3: count row as tabs); the chosen one on
// the teal tint.
const chipClass =
  'inline-flex min-h-11 items-center gap-2 rounded-control border border-line-control bg-surface px-3 text-sm text-ink-secondary hover:bg-surface-hover aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:font-medium aria-pressed:text-accent';

/**
 * The front desk Today board (INT-01): count chips that filter, the day's appointments by time
 * with status tags and waiting time, and the one tap action (Check in, or Undo check in for a
 * mistake). Live like the calendar: checked every `live.refresh_seconds`, only a changed board
 * is sent back; the page gives it a new key when the board changes after a post.
 */
export function TodayBoard({
  initial,
  version,
  renderedAt,
  centreId,
  date,
  lateMinutes,
  refreshSeconds,
  show,
  pricesPlans = false,
  notDelivered = [],
}: {
  initial: TodayRow[];
  version: string;
  renderedAt: number;
  centreId: string;
  date: string;
  lateMinutes: number;
  refreshSeconds: number;
  show?: TodayFilter;
  /** Whether the person sees bill amounts: a done consultation links to its plan sheet (BIL-01). */
  pricesPlans?: boolean;
  /** Patients with a WhatsApp message not delivered, on the panel above (WA-13). */
  notDelivered?: readonly string[];
}) {
  const [appointments, setAppointments] = useState(initial);
  const [filter, setFilter] = useState(show);
  const [checkedAt, setCheckedAt] = useState(renderedAt);
  const [failing, setFailing] = useState(false);
  const [now, setNow] = useState(renderedAt);
  const current = useRef(version);

  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, []);

  const { relay, connectedSeconds } = useLiveRelay();

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const query = new URLSearchParams({ centre: centreId, date, since: current.current });
        const response = await fetch(`/app/today/live?${query.toString()}`, {
          headers: { [LIVE_HEADER]: '1' },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`live check ${String(response.status)}`);
        const answer = (await response.json()) as {
          version: string;
          appointments?: TodayJson[];
        };
        if (stopped) return;
        if (answer.appointments) {
          setAppointments(answer.appointments.map(revive));
          current.current = answer.version;
        }
        setCheckedAt(Date.now());
        setFailing(false);
      } catch {
        if (!stopped) setFailing(true);
      }
    };
    // FND-09: at once when the realtime relay says this centre changed; on its own otherwise.
    const stop = scheduleLiveChecks(relay, check, {
      refreshSeconds,
      connectedSeconds,
      centres: [centreId],
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [centreId, date, refreshSeconds, relay, connectedSeconds]);

  const pick = (next: TodayFilter | undefined) => {
    setFilter(next);
    // Keep the chip in the address, so a reload or a post comes back to it.
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('show', next);
    else url.searchParams.delete('show');
    window.history.replaceState(window.history.state, '', url);
  };

  const shown = appointments.filter((a) => matches(a, filter));
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  return (
    <div className="flex flex-col gap-3">
      <p
        data-testid="live-status"
        data-volatile
        className={`text-sm ${failing ? 'text-waiting' : 'text-ink-muted'}`}
      >
        {failing
          ? `Not updated for ${String(seconds)} s. Checking again.`
          : `Live, updated ${String(seconds)} s ago`}
      </p>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={filter === undefined}
          onClick={() => {
            pick(undefined);
          }}
          className={chipClass}
        >
          All <span className="tabular-nums">{appointments.length}</span>
        </button>
        {todayFilters.map((option) => (
          <button
            key={option}
            type="button"
            data-filter={option}
            aria-pressed={filter === option}
            onClick={() => {
              pick(option);
            }}
            className={chipClass}
          >
            {todayFilterLabels[option]}{' '}
            <span className="tabular-nums">
              {appointments.filter((a) => matches(a, option)).length}
            </span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-panel border border-line bg-surface px-4 py-8 text-center">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-full bg-surface-sunken text-ink-muted"
          >
            <CalendarCheck size={20} strokeWidth={1.75} />
          </span>
          <p className="text-ink-muted">
            {filter ? `Nobody under ${todayFilterLabels[filter]}.` : 'No appointments today.'}
          </p>
          {filter ? null : (
            <Link
              href={calendarHref({ centreId, date, newBooking: {} })}
              className="text-sm font-medium text-accent underline underline-offset-2"
            >
              Book an appointment
            </Link>
          )}
        </div>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
          {shown.map((appointment) => {
            const status = shownStatus(appointment, now, lateMinutes);
            const here = appointment.status === 'checked_in' && appointment.arrivedAt;
            const label = here
              ? `Here ${String(minutesSince(appointment.arrivedAt as Date, now))} min`
              : shownStatusLabels[status];
            const late =
              status === 'running_late'
                ? `${String(minutesSince(appointment.startsAt, now))} min late`
                : undefined;
            // The row's action opens the check in drawer (INT-02) for this appointment.
            const drawerHref = todayHref({ centreId, show: filter, appointmentId: appointment.id });
            // On a phone the tag and waiting time sit under the name, the action beside them.
            return (
              <li
                key={appointment.id}
                data-testid="today-row"
                className="relative grid grid-cols-[3rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 py-3 pr-4 pl-5 md:grid-cols-[3rem_minmax(0,1fr)_14rem_12rem] md:items-center"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-[3px] ${stripClass[toneByAppointmentStatus[status]]}`}
                />
                <Link
                  href={calendarHref({ centreId, date, appointmentId: appointment.id })}
                  className="row-span-2 text-sm text-ink tabular-nums underline-offset-2 hover:underline md:row-span-1"
                >
                  {timeOf(appointment.startsAt)}
                  <span className="block text-sm text-ink-muted">{timeOf(appointment.endsAt)}</span>
                  {/* Named by the times it shows first (WCAG 2.5.3), then what it opens. */}
                  <span className="sr-only">, open {appointment.number}</span>
                </Link>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={`/app/patients/${appointment.patientId}`}
                    className="font-medium break-words text-ink underline-offset-2 hover:underline md:truncate"
                  >
                    {appointment.patientName}
                  </Link>
                  <span className="truncate text-sm text-ink-secondary">
                    {appointment.typeName} · {appointment.physioName}
                  </span>
                </span>
                <span className="col-start-2 row-start-2 flex flex-wrap items-center gap-2 md:col-start-3 md:row-start-1 md:justify-end">
                  {late ? <span className="text-sm text-waiting">{late}</span> : null}
                  <Tag tone={toneByAppointmentStatus[status]}>{label}</Tag>
                  {appointment.session?.label ? (
                    // SES-01: the treatment session's number once checked in.
                    <span data-testid="session-label">
                      <Tag tone="outline">{appointment.session.label}</Tag>
                    </span>
                  ) : null}
                  {appointment.session &&
                  !appointment.session.gate.met &&
                  ['booked', 'confirmed', 'checked_in'].includes(appointment.status) ? (
                    <span data-testid="session-gate" title={appointment.session.gate.message}>
                      <Tag tone="waiting">Gate blocked</Tag>
                    </span>
                  ) : null}
                  {notDelivered.includes(appointment.patientId) ? (
                    // WA-13: a WhatsApp message to them was not delivered; see the panel above.
                    <span data-testid="not-delivered-tag">
                      <Tag tone="waiting">Not delivered</Tag>
                    </span>
                  ) : null}
                  {appointment.consentDeclined ? (
                    // INT-06: the patient declined a Part A statement; reception speaks to them.
                    <Tag tone="danger">Consent declined</Tag>
                  ) : null}
                  {pricesPlans && appointment.unpaidFeePaise !== null ? (
                    // BIL-05: the consultation fee is billed and waiting at the counter.
                    <Tag tone="waiting">Unpaid {formatRupees(appointment.unpaidFeePaise)}</Tag>
                  ) : null}
                  {pricesPlans && appointment.unpaidFlagAbove !== null ? (
                    // BIL-10: over the set number of unpaid sessions; a flag, never a block.
                    <span data-testid="unpaid-flag">
                      <Tag tone="danger">Over {appointment.unpaidFlagAbove} unpaid sessions</Tag>
                    </span>
                  ) : null}
                </span>
                <span className="col-start-3 row-span-2 row-start-1 justify-self-end md:col-start-4 md:row-span-1">
                  {appointment.status === 'booked' || appointment.status === 'confirmed' ? (
                    <Link
                      href={drawerHref}
                      scroll={false}
                      aria-label={`Check in ${appointment.patientName}`}
                      className={fit(primaryButtonClass)}
                    >
                      Check in
                    </Link>
                  ) : appointment.status === 'checked_in' ? (
                    <Link
                      href={drawerHref}
                      scroll={false}
                      aria-label={`Form and reports for ${appointment.patientName}`}
                      className={fit(secondaryButtonClass)}
                    >
                      Form and reports
                    </Link>
                  ) : pricesPlans &&
                    appointment.status === 'completed' &&
                    appointment.consultation &&
                    appointment.episodeId ? (
                    <Link
                      href={`/app/plans/${appointment.episodeId}`}
                      aria-label={`Plan and payment for ${appointment.patientName}`}
                      className={fit(secondaryButtonClass)}
                    >
                      Plan and payment
                    </Link>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
