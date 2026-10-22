import type { CalendarAppointment } from '@clinic-mx/db';
import { appointmentStatusLabels, type AppointmentStatus } from '@clinic-mx/schemas';
import { toneByAppointmentStatus, type Tone } from '@clinic-mx/ui';
import Link from 'next/link';

/** What a block shows: the stored status, or Running late worked out from the time. */
export type ShownStatus = AppointmentStatus | 'running_late';

export const shownStatusLabels: Record<ShownStatus, string> = {
  ...appointmentStatusLabels,
  running_late: 'Running late',
};

/** Running late: booked or confirmed, not checked in, and past the start by the setting. */
export function shownStatus(
  appointment: Pick<CalendarAppointment, 'status' | 'startsAt'>,
  now: number,
  lateMinutes: number,
): ShownStatus {
  const waiting = appointment.status === 'booked' || appointment.status === 'confirmed';
  return waiting && now >= appointment.startsAt.getTime() + lateMinutes * 60_000
    ? 'running_late'
    : appointment.status;
}

const stripClass: Record<Tone, string> = {
  outline: 'bg-line-strong',
  neutral: 'bg-ink-muted',
  info: 'bg-info',
  waiting: 'bg-waiting',
  active: 'bg-active',
  done: 'bg-done',
  danger: 'bg-danger',
};

/** Live states sit on their tint and ends on theirs; everything else stays white. */
const fillClass: Partial<Record<ShownStatus, string>> = {
  checked_in: 'bg-info-soft',
  in_progress: 'bg-active-soft',
  completed: 'bg-done-soft',
  no_show: 'bg-danger-soft',
};

export const timeOf = (instant: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Kolkata',
  }).format(instant);

/**
 * The calendar block (design system "Calendar block"): the left strip is the status, the fill is
 * live or ended, the top line is the visit kind (with its time when the column is wide), then the
 * patient and the status in words. Cancelled and rescheduled stay in place, hatched and struck.
 */
export function CalendarBlock({
  appointment,
  status,
  href,
  selected,
}: {
  appointment: CalendarAppointment;
  status: ShownStatus;
  href: string;
  selected: boolean;
}) {
  const freed = status === 'cancelled' || status === 'rescheduled';
  const fill = freed ? 'cmx-hatch' : (fillClass[status] ?? 'bg-surface');
  return (
    <Link
      href={href}
      scroll={false}
      data-testid="calendar-block"
      aria-current={selected ? 'true' : undefined}
      className={`@container relative flex h-full flex-col overflow-hidden rounded-control border py-0.5 pr-1.5 pl-2.5 text-xs leading-tight text-ink ${fill} ${
        selected ? 'border-ink' : 'border-line'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-[3px] ${stripClass[toneByAppointmentStatus[status]]}`}
      />
      <span className="flex items-baseline gap-1 text-ink-secondary">
        <span className="truncate">{appointment.typeName}</span>
        <span
          className={`hidden shrink-0 tabular-nums @[9rem]:inline ${freed ? 'line-through' : ''}`}
        >
          {timeOf(appointment.startsAt)}
        </span>
        {appointment.machineUnit ? (
          <span className="ml-auto shrink-0 rounded-tag bg-surface-sunken px-1 text-ink-secondary">
            Treadmill {appointment.machineUnit}
          </span>
        ) : null}
      </span>
      <span className="truncate font-medium">{appointment.patientName}</span>
      <span className="truncate text-ink-secondary">{shownStatusLabels[status]}</span>
    </Link>
  );
}
