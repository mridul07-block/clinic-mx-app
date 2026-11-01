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

/**
 * The confirmation with the centre's map (user decisions, 1 November 2026): sent when the centre
 * has its coordinates, as the `appointment_confirmation` template, or inside the window as a pin
 * (`clinic_location`) followed by the same text with its buttons.
 */
export const MAP_CONFIRMATION_KEY = 'appointment_confirmation';
export const CLINIC_LOCATION_KEY = 'clinic_location';

export interface MapPlace {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
}

/** A centre's place as a message's variables, kept with it until it is sent. */
export function mapPlaceVariables(place: MapPlace): Record<string, string> {
  return {
    map_latitude: String(place.latitude),
    map_longitude: String(place.longitude),
    map_name: place.name,
    map_address: place.address,
  };
}

/** The place a message's variables hold, if whole. */
export function mapPlaceOf(variables: Record<string, string>): MapPlace | undefined {
  const latitude = Number(variables.map_latitude);
  const longitude = Number(variables.map_longitude);
  if (
    !variables.map_latitude ||
    !variables.map_longitude ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return undefined;
  }
  return {
    latitude,
    longitude,
    name: variables.map_name ?? '',
    address: variables.map_address ?? '',
  };
}
