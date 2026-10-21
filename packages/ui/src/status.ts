/**
 * Status tones (design system v2 section 2.3). Every tone is a tint, strong text, a same-hue
 * border and always a word: colour is never the only signal.
 */
export type Tone = 'neutral' | 'outline' | 'info' | 'waiting' | 'active' | 'done' | 'danger';

export const appointmentStatuses = [
  'booked',
  'confirmed',
  'checked_in',
  'running_late',
  'in_progress',
  'completed',
  'cancelled',
  'rescheduled',
  'no_show',
] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

/**
 * Tag tone per appointment status (Frontend Specification section 9). Checked in is blue
 * (info), not amber as in design v2, so amber only ever means "needs attention". Cancelled and
 * rescheduled blocks are also hatched and struck through on the calendar.
 */
export const toneByAppointmentStatus = {
  booked: 'outline',
  confirmed: 'neutral',
  checked_in: 'info',
  running_late: 'waiting',
  in_progress: 'active',
  completed: 'done',
  cancelled: 'done',
  rescheduled: 'done',
  no_show: 'danger',
} as const satisfies Record<AppointmentStatus, Tone>;
