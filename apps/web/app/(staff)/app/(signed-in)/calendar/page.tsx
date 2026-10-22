import { appointmentTypeList, calendarVersion, centreList, searchPatients } from '@clinic-mx/db';
import {
  addDays,
  calendarDateSchema,
  can,
  formatIstDate,
  istDate,
  patientSearch,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage, primaryButtonClass } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { loadCalendar, slotOptions } from '../../../../../modules/scheduling/calendar';
import { findFreeSlots, heldSlot } from '../../../../../modules/scheduling/services';
import { getSetting } from '../../../../../modules/settings/settings';
import { shownStatus } from './calendar-block';
import { CalendarView } from './calendar-view';
import { BookingSheet, NewBookingSheet } from './booking-sheet';
import { AppointmentDrawer, SlotDrawer } from './drawer';
import { calendarHref, readSlot } from './links';

export const metadata: Metadata = { title: 'Calendar · Clinic Mx' };

const pillClass = 'rounded-control border px-3 py-1.5 text-sm pointer-coarse:py-2.5';

const weekday = (date: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

// The calendar day view (SCH-05, Frontend Specification "Calendar"): a column per physio with the
// consultant's fee in the header, free slots that open the drawer, appointment details in the
// drawer, and live updates. The Super Admin, Centre Managers and the Front Desk see every physio at
// a centre; a physio sees their own column. The address carries the centre, date and drawer.
// Phones get the agenda, one physio or everyone at a time, with details in a bottom sheet (SCH-06).
// The front desk books from a free slot or New booking: the start is held, then the patient is
// found or added with a name and mobile (SCH-07).
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    centre?: string;
    date?: string;
    physio?: string;
    appointment?: string;
    slot?: string;
    booked?: string;
    book?: string;
    type?: string;
    find?: string;
    new?: string;
    on?: string;
  }>;
}) {
  const staff = await requirePermission('calendar.view');
  const params = await searchParams;
  const centres = (await asStaff(staff, (tx) => centreList(tx))).filter((c) => c.active);
  const today = istDate(new Date());
  const date = calendarDateSchema.safeParse(params.date).success ? (params.date ?? today) : today;
  const centre =
    centres.find((c) => c.id === params.centre) ??
    centres.find((c) => staff.centreIds.includes(c.id)) ??
    centres[0];
  if (!centre) {
    return (
      <main className="flex flex-col gap-4 px-4 py-6">
        <h1 className="text-title font-semibold">Calendar</h1>
        <FormMessage tone="info">There is no centre to show.</FormMessage>
      </main>
    );
  }

  const [step, lateMinutes, refreshSeconds] = [
    await getSetting('scheduling.slot_minutes'),
    await getSetting('day.running_late_minutes'),
    await getSetting('live.refresh_seconds'),
  ];
  const day = await loadCalendar(staff, { centreId: centre.id, date });
  const renderedAt = new Date().getTime();
  const version = calendarVersion(day);
  // The physio picked on a phone; only one of the day's columns, so a physio stays on their own.
  const physioId = day.columns.some((c) => c.physioId === params.physio)
    ? params.physio
    : undefined;
  const closeHref = calendarHref({ centreId: centre.id, date, physioId });

  const opened = day.columns.flatMap((column) =>
    column.appointments
      .filter((a) => a.id === params.appointment)
      .map((appointment) => ({ appointment, physioName: column.physioName })),
  )[0];
  const slot = readSlot(params.slot);
  const slotColumn = slot ? day.columns.find((c) => c.physioId === slot.physioId) : undefined;
  const options =
    slot && slotColumn ? await slotOptions(staff, { centreId: centre.id, ...slot }) : undefined;

  // Booking (SCH-07): only for those who book; the services refuse anyone else as well.
  const canBook = can(staff, 'bookings.manage') && !staff.support;
  const types = canBook
    ? (await asStaff(staff, (tx) => appointmentTypeList(tx))).filter((type) => type.active)
    : [];
  const typeOf = (id: string | undefined) => types.find((type) => type.id === id);

  const book = canBook ? readSlot(params.book) : undefined;
  const bookType = typeOf(params.type);
  const bookColumn = book ? day.columns.find((c) => c.physioId === book.physioId) : undefined;
  const bookChoice =
    book && bookType && bookColumn
      ? {
          centreId: centre.id,
          physioId: book.physioId,
          appointmentTypeId: bookType.id,
          startsAt: book.startsAt.toISOString(),
        }
      : undefined;
  const hold = bookChoice ? await heldSlot(staff) : undefined;
  const heldUntil =
    hold &&
    hold.physioId === bookChoice?.physioId &&
    hold.appointmentTypeId === bookChoice.appointmentTypeId &&
    hold.startsAt.toISOString() === bookChoice.startsAt
      ? hold.expiresAt
      : undefined;
  const find = bookChoice ? (params.find ?? '') : '';
  const search = patientSearch(find);
  const results = search ? await asStaff(staff, (tx) => searchPatients(tx, search)) : undefined;

  const newBooking = canBook && params.new === '1' && !bookChoice;
  const on = calendarDateSchema.safeParse(params.on).success ? (params.on ?? date) : date;
  const newType = newBooking ? typeOf(params.type) : undefined;
  const newSlots = newType
    ? await findFreeSlots(staff, { centreId: centre.id, date: on, appointmentTypeId: newType.id })
    : undefined;

  const dayLabel = `${weekday(date)}, ${formatIstDate(date)}`;
  return (
    <main className="flex w-full flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
            Home
          </Link>
          <h1 className="text-title font-semibold">Calendar</h1>
          <p className="text-sm text-ink-muted">
            {centre.name} · {dayLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBook ? (
            <Link
              href={calendarHref({ centreId: centre.id, date, physioId, newBooking: {} })}
              scroll={false}
              className={`${primaryButtonClass} sm:w-auto`}
            >
              New booking
            </Link>
          ) : null}
          <nav aria-label="Day" className="flex items-center gap-2">
            <Link
              href={calendarHref({ centreId: centre.id, date: addDays(date, -1), physioId })}
              className={`${pillClass} border-line-control`}
            >
              Previous day
            </Link>
            <Link
              href={calendarHref({ centreId: centre.id, date: today, physioId })}
              aria-current={date === today ? 'date' : undefined}
              className={`${pillClass} border-line-control`}
            >
              Today
            </Link>
            <Link
              href={calendarHref({ centreId: centre.id, date: addDays(date, 1), physioId })}
              className={`${pillClass} border-line-control`}
            >
              Next day
            </Link>
          </nav>
        </div>
      </div>
      {centres.length > 1 ? (
        <nav aria-label="Centre" className="flex flex-wrap gap-2">
          {centres.map((c) => (
            <Link
              key={c.id}
              href={calendarHref({ centreId: c.id, date })}
              aria-current={c.id === centre.id ? 'page' : undefined}
              className={`${pillClass} ${
                c.id === centre.id
                  ? 'border-ink bg-surface font-medium text-ink'
                  : 'border-line-control text-ink-secondary'
              }`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {day.columns.length === 0 ? (
        <FormMessage tone="info">
          Nobody has hours at {centre.name} on {dayLabel}.
        </FormMessage>
      ) : (
        <CalendarView
          key={`${centre.id}:${date}:${version}`}
          initial={day}
          version={version}
          renderedAt={renderedAt}
          centreId={centre.id}
          date={date}
          step={step}
          lateMinutes={lateMinutes}
          refreshSeconds={refreshSeconds}
          physioId={physioId}
          selectedAppointment={opened?.appointment.id}
        />
      )}

      {opened ? (
        <AppointmentDrawer
          appointment={opened.appointment}
          status={shownStatus(opened.appointment, renderedAt, lateMinutes)}
          physioName={opened.physioName}
          centreName={centre.name}
          closeHref={closeHref}
          booked={params.booked === '1'}
        />
      ) : null}
      {slot && slotColumn && options ? (
        <SlotDrawer
          startsAt={slot.startsAt}
          physioName={slotColumn.physioName}
          options={options}
          closeHref={closeHref}
          book={
            canBook ? { centreId: centre.id, physioId: slot.physioId, view: physioId } : undefined
          }
        />
      ) : null}
      {bookChoice && bookType && bookColumn ? (
        <BookingSheet
          choice={bookChoice}
          date={date}
          view={physioId}
          typeName={bookType.name}
          physioName={bookColumn.physioName}
          centreName={centre.name}
          heldUntil={heldUntil}
          find={find}
          results={results}
          closeHref={closeHref}
        />
      ) : null}
      {newBooking ? (
        <NewBookingSheet
          centreId={centre.id}
          date={date}
          view={physioId}
          types={types}
          typeId={newType?.id}
          on={on}
          slots={newSlots}
          closeHref={closeHref}
        />
      ) : null}
    </main>
  );
}
