/**
 * The calendar's address carries what it shows (SCH-05): the centre, the date, the physio picked
 * on a phone (SCH-06), an open appointment or free slot, and a booking in progress (SCH-07: the
 * held start and its type, the patient search, the New booking sheet), so links and the browser's
 * back button work without scripts.
 */
export function calendarHref(view: {
  centreId: string;
  date: string;
  physioId?: string;
  appointmentId?: string;
  slot?: { physioId: string; startsAt: Date };
  /** Booking a held start: the booking sheet. */
  book?: { physioId: string; startsAt: Date; appointmentTypeId: string };
  /** The booking sheet's patient search, as typed. */
  find?: string;
  /** The New booking sheet, with the type and day picked so far. */
  newBooking?: { appointmentTypeId?: string; on?: string };
  /** The appointment was just booked. */
  booked?: boolean;
}): string {
  const query = new URLSearchParams({ centre: view.centreId, date: view.date });
  if (view.physioId) query.set('physio', view.physioId);
  if (view.appointmentId) query.set('appointment', view.appointmentId);
  if (view.booked) query.set('booked', '1');
  if (view.slot) query.set('slot', `${view.slot.physioId}@${view.slot.startsAt.toISOString()}`);
  if (view.book) {
    query.set('book', `${view.book.physioId}@${view.book.startsAt.toISOString()}`);
    query.set('type', view.book.appointmentTypeId);
    if (view.find) query.set('find', view.find);
  }
  if (view.newBooking) {
    query.set('new', '1');
    if (view.newBooking.appointmentTypeId) query.set('type', view.newBooking.appointmentTypeId);
    if (view.newBooking.on) query.set('on', view.newBooking.on);
  }
  return `/app/calendar?${query.toString()}`;
}
