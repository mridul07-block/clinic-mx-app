import type { CalendarAppointment, PhysioSlots } from '@clinic-mx/db';
import { formatIstDate, istDate } from '@clinic-mx/schemas';
import Link from 'next/link';
import { secondaryButtonClass } from '../../../../../components/forms';
import {
  CancelAppointmentForm,
  CancelBookingButton,
  HoldButton,
  MarkNoShowForm,
  RescheduleForm,
} from './booking-forms';
import { timeOf } from './calendar-block';
import { Detail, Drawer, linkClass } from './drawer';

const inputClass =
  'h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs hover:border-ink-muted pointer-coarse:h-row-touch';

const chipClass =
  'inline-flex min-h-11 items-center rounded-control border border-line-control bg-surface px-3 text-sm text-ink tabular-nums hover:bg-surface-hover disabled:text-ink-faint';

/** Where the change sheets sit: the appointment's centre and day, and the phone's physio. */
export interface ChangeView {
  centreId: string;
  centreName: string;
  date: string;
  view?: string;
  /** Back to the appointment's own sheet. */
  backHref: string;
}

const when = (appointment: { startsAt: Date }, physioName: string) =>
  `${formatIstDate(istDate(appointment.startsAt))}, ${timeOf(appointment.startsAt)} with ${physioName}`;

/**
 * Cancel an appointment (SCH-08): who asked, then Cancel appointment. The form is the
 * confirmation (design system: a dialog only for what cannot be undone elsewhere); Keep it goes
 * back.
 */
export function CancelSheet({
  appointment,
  physioName,
  place,
}: {
  appointment: CalendarAppointment;
  physioName: string;
  place: ChangeView;
}) {
  return (
    <Drawer label="Cancel appointment" closeHref={place.backHref}>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm text-ink-secondary">{appointment.number}</p>
        <h2 className="text-title font-semibold text-ink">Cancel {appointment.typeName}</h2>
        <p className="text-ink-secondary">
          {appointment.patientName}, {when(appointment, physioName)}
        </p>
      </div>
      <CancelAppointmentForm
        place={{
          appointmentId: appointment.id,
          centreId: place.centreId,
          date: place.date,
          view: place.view,
        }}
      />
      <Link href={place.backHref} scroll={false} className={secondaryButtonClass}>
        Keep it
      </Link>
    </Drawer>
  );
}

/**
 * Mark a no show (INT-11, user decision 23 October 2026: a confirm sheet, like Cancel). It counts
 * towards the self booking block; one marked by mistake is undone on the same day.
 */
export function NoShowSheet({
  appointment,
  physioName,
  place,
}: {
  appointment: CalendarAppointment;
  physioName: string;
  place: ChangeView;
}) {
  return (
    <Drawer label="Mark no show" closeHref={place.backHref}>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm text-ink-secondary">{appointment.number}</p>
        <h2 className="text-title font-semibold text-ink">
          Mark {appointment.number} as a no show?
        </h2>
        <p className="text-ink-secondary">
          {appointment.patientName}, {appointment.typeName}, {when(appointment, physioName)}
        </p>
      </div>
      <p className="text-ink-secondary">
        It counts toward the self booking block, and the front desk gets a call task. If the patient
        arrives after all, undo it today.
      </p>
      <MarkNoShowForm
        place={{
          appointmentId: appointment.id,
          centreId: place.centreId,
          date: place.date,
          view: place.view,
        }}
      />
      <Link href={place.backHref} scroll={false} className={secondaryButtonClass}>
        Back
      </Link>
    </Drawer>
  );
}

/**
 * Reschedule, step one (SCH-08): the same type, on a day and with a physio (the appointment's own
 * to begin with, any of them on request); its own time counts as free. A start holds it and opens
 * step two.
 */
export function ReschedulePicker({
  appointment,
  physioName,
  place,
  physios,
  on,
  withPhysio,
  slots,
}: {
  appointment: CalendarAppointment;
  physioName: string;
  place: ChangeView;
  /** The physios to choose from: everyone with hours at the centre that day. */
  physios: { id: string; name: string }[];
  on: string;
  /** A physio's id, or "any". */
  withPhysio: string;
  slots: PhysioSlots[];
}) {
  const shown = slots.filter((physio) => physio.slots.length > 0);
  return (
    <Drawer label="Reschedule" closeHref={place.backHref}>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm text-ink-secondary">{appointment.number}</p>
        <h2 className="text-title font-semibold text-ink">Reschedule {appointment.typeName}</h2>
        <p className="text-ink-secondary">
          {appointment.patientName}, now {when(appointment, physioName)}
        </p>
      </div>
      <form action="/app/calendar" className="flex flex-col gap-3">
        <input type="hidden" name="centre" value={place.centreId} />
        <input type="hidden" name="date" value={place.date} />
        {place.view ? <input type="hidden" name="physio" value={place.view} /> : null}
        <input type="hidden" name="appointment" value={appointment.id} />
        <input type="hidden" name="change" value="reschedule" />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="move-on" className="font-medium text-ink">
            Date
          </label>
          <input id="move-on" name="on" type="date" defaultValue={on} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="move-with" className="font-medium text-ink">
            Physio
          </label>
          <select id="move-with" name="with" defaultValue={withPhysio} className={inputClass}>
            <option value="any">Any physio</option>
            {physios.map((physio) => (
              <option key={physio.id} value={physio.id}>
                {physio.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={secondaryButtonClass}>
          Show free times
        </button>
      </form>
      {shown.length === 0 ? (
        <p className="text-ink-muted" data-testid="no-free-times">
          No free time for {appointment.typeName} on {formatIstDate(on)}.
        </p>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Free times">
          {shown.map((physio) => (
            <li key={physio.physioId} className="flex flex-col gap-2">
              <span className="font-medium text-ink">{physio.physioName}</span>
              <span className="flex flex-wrap gap-2">
                {physio.slots.map((slot) => (
                  <HoldButton
                    key={slot.startsAt.toISOString()}
                    choice={{
                      centreId: place.centreId,
                      physioId: physio.physioId,
                      appointmentTypeId: appointment.appointmentTypeId,
                      startsAt: slot.startsAt.toISOString(),
                    }}
                    view={place.view}
                    move={{ appointmentId: appointment.id, date: place.date }}
                    label={timeOf(slot.startsAt)}
                    name={`Move to ${timeOf(slot.startsAt)} with ${physio.physioName}`}
                    className={chipClass}
                  />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

/** Reschedule, step two (SCH-08): from and to, the hold, who asked, then Reschedule. */
export function RescheduleConfirm({
  appointment,
  physioName,
  place,
  to,
  toPhysioName,
  heldUntil,
}: {
  appointment: CalendarAppointment;
  physioName: string;
  place: ChangeView;
  to: { physioId: string; startsAt: Date };
  toPhysioName: string;
  heldUntil?: Date;
}) {
  return (
    <Drawer
      label="Reschedule"
      closeHref={place.backHref}
      footer={<CancelBookingButton centreId={place.centreId} date={place.date} view={place.view} />}
    >
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm text-ink-secondary">{appointment.number}</p>
        <h2 className="text-title font-semibold text-ink">Reschedule {appointment.typeName}</h2>
        <p
          data-testid="hold-status"
          className={heldUntil ? 'text-ink-secondary' : 'text-waiting-strong'}
        >
          {heldUntil
            ? `Held for you until ${timeOf(heldUntil)}`
            : 'Your hold ran out. Reschedule still works if the time is free.'}
        </p>
      </div>
      <dl className="flex flex-col gap-3">
        <Detail term="Patient">{appointment.patientName}</Detail>
        <Detail term="From">{when(appointment, physioName)}</Detail>
        <Detail term="To">
          <span className="font-medium">{when(to, toPhysioName)}</span>
        </Detail>
      </dl>
      <RescheduleForm
        place={{
          appointmentId: appointment.id,
          centreId: place.centreId,
          date: place.date,
          view: place.view,
        }}
        physioId={to.physioId}
        startsAt={to.startsAt.toISOString()}
      />
      <Link href={place.backHref} scroll={false} className={linkClass}>
        Back to the appointment
      </Link>
    </Drawer>
  );
}
