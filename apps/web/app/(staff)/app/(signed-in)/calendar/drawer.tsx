import type { CalendarAppointment } from '@clinic-mx/db';
import {
  appointmentChangeReasonLabels,
  bookingChannelLabels,
  formatIstDate,
  formatIstDateTime,
  istDate,
} from '@clinic-mx/schemas';
import { toneByAppointmentStatus } from '@clinic-mx/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import type { SlotOption } from '../../../../../modules/scheduling/calendar';
import { HoldButton, UndoNoShowButton, type ChangePlace } from './booking-forms';
import { shownStatusLabels, timeOf, type ShownStatus } from './calendar-block';
import { DrawerKeys } from './drawer-keys';
import { calendarHref } from './links';

export const linkClass = 'text-accent underline underline-offset-2';

const bookClass = `${primaryButtonClass.replace('w-full', 'w-auto')} shrink-0`;

/**
 * The right drawer (design system: details open in a right drawer so the calendar stays visible,
 * 480 px). On a phone it is a sheet that slides up from the bottom, with its actions pinned at the
 * bottom (Frontend Specification section 4, SCH-06). Close, or Esc, goes back to the plain day.
 */
export function Drawer({
  label,
  closeHref,
  footer,
  children,
}: {
  label: string;
  closeHref: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      data-testid="calendar-drawer"
      data-state="open"
      className="animate-sheet md:animate-drawer fixed inset-x-0 bottom-0 z-40 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-drawer border border-line bg-surface shadow-float md:inset-x-auto md:inset-y-2 md:right-2 md:max-h-none md:w-[30rem] md:rounded-drawer md:shadow-drawer"
    >
      <DrawerKeys closeHref={closeHref} />
      <div className="flex justify-end px-6 pt-4">
        <Link href={closeHref} scroll={false} className={`${linkClass} pointer-coarse:py-2.5`}>
          Close
        </Link>
      </div>
      <div
        className={`flex flex-1 flex-col gap-5 overflow-y-auto px-6 ${
          footer ? 'pb-6' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]'
        }`}
      >
        {children}
      </div>
      {footer ? (
        <div
          data-testid="drawer-footer"
          className="border-t border-line bg-surface-subtle px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {footer}
        </div>
      ) : null}
    </aside>
  );
}

export function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/**
 * No show actions for those who check in (INT-11): Mark no show from the setting's minutes after
 * the start (a note says when until then), or Undo no show on the appointment's own day.
 */
export interface NoShowActions {
  place: ChangePlace;
  /** Booked or Confirmed: when a no show may be marked, and the confirm sheet once it may. */
  mark?: { allowedFrom: Date; href?: string };
  /** A no show on its own day. */
  undo?: boolean;
}

/** An appointment's details (SCH-05); its actions come with check in, reschedule and cancel. */
export function AppointmentDrawer({
  appointment,
  status,
  physioName,
  centreName,
  closeHref,
  booked = false,
  moved = false,
  change,
  noShow,
}: {
  appointment: CalendarAppointment;
  status: ShownStatus;
  physioName: string;
  centreName: string;
  closeHref: string;
  /** Just booked from the calendar (SCH-07). */
  booked?: boolean;
  /** Just booked in place of another (SCH-08). */
  moved?: boolean;
  /** For someone who books, while it is Booked or Confirmed: where Reschedule and Cancel go. */
  change?: { rescheduleHref: string; cancelHref: string };
  noShow?: NoShowActions;
}) {
  const day = istDate(appointment.startsAt);
  const linkTo = (other: NonNullable<CalendarAppointment['rescheduledTo']>) =>
    calendarHref({ centreId: other.centreId, date: other.date, appointmentId: other.id });
  return (
    <Drawer
      label="Appointment"
      closeHref={closeHref}
      footer={
        change || noShow?.mark || noShow?.undo ? (
          <div className="flex flex-col gap-2">
            {change ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link href={change.rescheduleHref} scroll={false} className={secondaryButtonClass}>
                  Reschedule
                </Link>
                <Link href={change.cancelHref} scroll={false} className={dangerButtonClass}>
                  Cancel appointment
                </Link>
              </div>
            ) : null}
            {noShow?.mark?.href ? (
              <Link href={noShow.mark.href} scroll={false} className={secondaryButtonClass}>
                Mark no show
              </Link>
            ) : noShow?.mark ? (
              <p data-testid="no-show-from" className="text-sm text-ink-muted">
                No show can be marked from {timeOf(noShow.mark.allowedFrom)}.
              </p>
            ) : null}
            {noShow?.undo ? <UndoNoShowButton place={noShow.place} /> : null}
          </div>
        ) : undefined
      }
    >
      {moved && appointment.rescheduledFrom ? (
        <div
          role="status"
          data-testid="moved"
          className="flex flex-col gap-1 rounded-panel border border-active-line bg-active-soft px-4 py-3"
        >
          <span className="font-semibold text-active">Rescheduled to {appointment.number}</span>
          <span className="text-sm text-ink-secondary">
            {appointment.rescheduledFrom.number} is now Rescheduled; its time is free.
          </span>
        </div>
      ) : null}
      {booked ? (
        <div
          role="status"
          data-testid="booked"
          className="flex flex-col gap-1 rounded-panel border border-active-line bg-active-soft px-4 py-3"
        >
          <span className="font-semibold text-active">Booked {appointment.number}</span>
          <span className="text-sm text-ink-secondary">
            The WhatsApp confirmation starts with the WhatsApp integration.
          </span>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <p className="font-mono text-sm text-ink-secondary">{appointment.number}</p>
        <h2 className="text-title font-semibold text-ink">{appointment.typeName}</h2>
        <span>
          <Tag tone={toneByAppointmentStatus[status]}>{shownStatusLabels[status]}</Tag>
        </span>
      </div>
      <dl className="flex flex-col gap-3">
        <Detail term="Patient">
          <Link href={`/app/patients/${appointment.patientId}`} className={linkClass}>
            {appointment.patientName}
          </Link>{' '}
          <span className="font-mono text-sm text-ink-secondary">{appointment.opNumber}</span>
        </Detail>
        <Detail term="When">
          {formatIstDate(day)}, {timeOf(appointment.startsAt)} to {timeOf(appointment.endsAt)}
        </Detail>
        <Detail term="With">
          {physioName} at {centreName}
        </Detail>
        {appointment.machineUnit ? (
          <Detail term="Zero Gravity Treadmill">Treadmill {appointment.machineUnit}</Detail>
        ) : null}
        <Detail term="Booked">
          {appointment.bookedByName
            ? `${bookingChannelLabels[appointment.channel]}, by ${appointment.bookedByName}`
            : bookingChannelLabels[appointment.channel]}
        </Detail>
        {appointment.changeReason ? (
          <Detail term={status === 'rescheduled' ? 'Rescheduled' : 'Cancelled'}>
            {appointmentChangeReasonLabels[appointment.changeReason]}
            {appointment.changedByName ? `, by ${appointment.changedByName}` : ''}
            {appointment.changedAt
              ? `, ${formatIstDate(istDate(appointment.changedAt))} ${timeOf(appointment.changedAt)}`
              : ''}
          </Detail>
        ) : null}
        {appointment.noShowAt ? (
          <Detail term="No show">
            Marked
            {appointment.noShowByName ? ` by ${appointment.noShowByName}` : ''},{' '}
            {formatIstDateTime(appointment.noShowAt)}
          </Detail>
        ) : null}
        {appointment.rescheduledTo ? (
          <Detail term="Rescheduled to">
            <Link href={linkTo(appointment.rescheduledTo)} className={linkClass}>
              {appointment.rescheduledTo.number}
            </Link>
          </Detail>
        ) : null}
        {appointment.rescheduledFrom ? (
          <Detail term="Moved from">
            <Link href={linkTo(appointment.rescheduledFrom)} className={linkClass}>
              {appointment.rescheduledFrom.number}
            </Link>
          </Detail>
        ) : null}
        {appointment.episodeId ? (
          <Detail term="Episode">
            <Link href={`/app/patients/${appointment.patientId}`} className={linkClass}>
              On the patient’s page
            </Link>
          </Detail>
        ) : null}
      </dl>
    </Drawer>
  );
}

/**
 * A free start (SCH-05): which appointment types fit there. Someone who books gets "Book" on each
 * that fits, which holds the start and opens the booking sheet (SCH-07).
 */
export function SlotDrawer({
  startsAt,
  physioName,
  options,
  closeHref,
  book,
}: {
  startsAt: Date;
  physioName: string;
  options: SlotOption[];
  closeHref: string;
  /** For someone who books (SCH-07): where, for whom and the phone's picked physio. */
  book?: { centreId: string; physioId: string; view?: string };
}) {
  return (
    <Drawer
      label="Free slot"
      closeHref={closeHref}
      footer={
        book ? undefined : (
          <p className="text-sm text-ink-muted">Only the front desk and managers book.</p>
        )
      }
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold text-ink">
          Free at {timeOf(startsAt)} with {physioName}
        </h2>
        <p className="text-ink-secondary">{formatIstDate(istDate(startsAt))}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line" data-testid="slot-options">
        {options.map((option) => (
          <li key={option.appointmentTypeId} className="flex flex-col gap-0.5 py-2.5">
            <span className="flex items-center justify-between gap-3">
              <span className="font-medium text-ink">{option.name}</span>
              {option.refusal ? (
                <Tag tone="neutral">Does not fit</Tag>
              ) : (
                <span className="flex items-center gap-2">
                  <Tag tone="active">Fits, {option.minutes} min</Tag>
                  {book ? (
                    <HoldButton
                      choice={{
                        centreId: book.centreId,
                        physioId: book.physioId,
                        appointmentTypeId: option.appointmentTypeId,
                        startsAt: startsAt.toISOString(),
                      }}
                      view={book.view}
                      label="Book"
                      name={`Book ${option.name} at ${timeOf(startsAt)}`}
                      className={bookClass}
                    />
                  ) : null}
                </span>
              )}
            </span>
            {option.refusal ? (
              <span className="text-sm text-ink-secondary">{option.refusal}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
