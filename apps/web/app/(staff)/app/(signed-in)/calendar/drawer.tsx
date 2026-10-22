import type { CalendarAppointment } from '@clinic-mx/db';
import { bookingChannelLabels, formatIstDate, istDate } from '@clinic-mx/schemas';
import { toneByAppointmentStatus } from '@clinic-mx/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Tag } from '../../../../../components/tag';
import type { SlotOption } from '../../../../../modules/scheduling/calendar';
import { shownStatusLabels, timeOf, type ShownStatus } from './calendar-block';
import { DrawerKeys } from './drawer-keys';

const linkClass = 'text-accent underline underline-offset-2';

/**
 * The right drawer (design system: details open in a right drawer so the calendar stays visible;
 * 480 px on desktop, the full width on a phone). Close, or Esc, goes back to the plain day.
 */
function Drawer({
  label,
  closeHref,
  children,
}: {
  label: string;
  closeHref: string;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      data-testid="calendar-drawer"
      className="animate-drawer fixed inset-y-2 right-2 z-40 flex w-[calc(100%-1rem)] max-w-[30rem] flex-col gap-5 overflow-y-auto rounded-drawer border border-line bg-surface p-6 shadow-drawer"
    >
      <DrawerKeys closeHref={closeHref} />
      <div className="flex justify-end">
        <Link href={closeHref} scroll={false} className={linkClass}>
          Close
        </Link>
      </div>
      {children}
    </aside>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/** An appointment's details (SCH-05); its actions come with check in, reschedule and cancel. */
export function AppointmentDrawer({
  appointment,
  status,
  physioName,
  centreName,
  closeHref,
}: {
  appointment: CalendarAppointment;
  status: ShownStatus;
  physioName: string;
  centreName: string;
  closeHref: string;
}) {
  const day = istDate(appointment.startsAt);
  return (
    <Drawer label="Appointment" closeHref={closeHref}>
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

/** A free start (SCH-05): which appointment types fit there. Booking it comes next (SCH-07). */
export function SlotDrawer({
  startsAt,
  physioName,
  options,
  closeHref,
}: {
  startsAt: Date;
  physioName: string;
  options: SlotOption[];
  closeHref: string;
}) {
  return (
    <Drawer label="Free slot" closeHref={closeHref}>
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
                <Tag tone="active">Fits, {option.minutes} min</Tag>
              )}
            </span>
            {option.refusal ? (
              <span className="text-sm text-ink-secondary">{option.refusal}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">Booking a patient from the calendar comes next.</p>
    </Drawer>
  );
}
