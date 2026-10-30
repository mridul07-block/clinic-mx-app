import { formatRupees } from './money';
import type { BookingChannel } from './slots';

/**
 * The booking confirmation (WA-07; PRD J1.4, J1.5): the same text for every booking, as the
 * `booking_confirmation` template when it was made on WhatsApp and `front_desk_booking_confirmation`
 * when the clinic made it (desk, walk in, automatic). Decisions (user, 31 October 2026): a
 * consultation states the physio's fee, any other appointment "as per your treatment plan"; until
 * Meta approves a version, the same text goes as a plain reply within WhatsApp's 24 hour window.
 */

/** The template a booking's confirmation goes as, by who booked it. */
export function confirmationTemplateKey(
  channel: BookingChannel,
): 'booking_confirmation' | 'front_desk_booking_confirmation' {
  return channel === 'whatsapp' ? 'booking_confirmation' : 'front_desk_booking_confirmation';
}

/** How to get there: the centre's map link, else its address, else the front desk. */
export function confirmationDirections(mapLink: string | null, address: string | null): string {
  return mapLink ?? address ?? 'please ask the front desk';
}

/** The fee line: a consultation's fee payable at the clinic, else as per the plan. */
export function confirmationFee(typeKey: string, consultationFeePaise: number | null): string {
  if (typeKey !== 'consultation') return 'as per your treatment plan';
  return consultationFeePaise === null
    ? 'payable at the clinic'
    : `${formatRupees(consultationFeePaise)}, payable at the clinic`;
}
