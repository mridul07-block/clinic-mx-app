/** What just happened in the check in drawer, for its message (INT-02). */
export type CheckInDone = 'checked-in' | 'undone' | 'tablet' | 'reports';

/**
 * The Today board's address (INT-01): its centre and the chip picked, if any; and the check in
 * drawer (INT-02): the appointment open in it, the QR shown, and what was just done.
 */
export function todayHref(view: {
  centreId: string;
  show?: string;
  appointmentId?: string;
  qr?: boolean;
  done?: CheckInDone;
}): string {
  const query = new URLSearchParams({ centre: view.centreId });
  if (view.show) query.set('show', view.show);
  if (view.appointmentId) query.set('appointment', view.appointmentId);
  if (view.qr) query.set('qr', '1');
  if (view.done) query.set('done', view.done);
  return `/app/today?${query.toString()}`;
}
