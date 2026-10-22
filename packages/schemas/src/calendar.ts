import { z } from 'zod';
import type { BookingChannel } from './slots';

/**
 * The calendar day view (SCH-05) and the consultation fee behind its column headers (decision G4;
 * PRD section 7: the consultation fee by the consulting physio's level).
 */

/** Which day at which centre; the page's address carries both. */
export const calendarQuerySchema = z.object({
  centreId: z.guid(),
  date: z.iso.date(),
});

export type CalendarQuery = z.output<typeof calendarQuerySchema>;

/** A free start picked on the calendar: what could be booked there (the drawer). */
export const slotOptionsQuerySchema = z.object({
  centreId: z.guid(),
  physioId: z.guid(),
  startsAt: z.coerce.date(),
});

export const bookingChannelLabels = {
  whatsapp: 'WhatsApp',
  front_desk: 'Front desk',
} as const satisfies Record<BookingChannel, string>;

/** Setting or clearing a consultant's consultation fee: a price item, or empty for none. */
export const consultationFeeSchema = z.object({
  staffUserId: z.guid(),
  priceItemId: z.union([z.guid(), z.literal('').transform(() => null)]),
});

export type ConsultationFeeInput = z.output<typeof consultationFeeSchema>;
