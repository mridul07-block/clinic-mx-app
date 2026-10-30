import { describe, expect, it } from 'vitest';
import {
  confirmationDirections,
  confirmationFee,
  confirmationTemplateKey,
} from './booking-confirmation';

// WA-07 (user decision, 31 October 2026): a consultation states the physio's fee, any other
// appointment "as per your treatment plan"; the template by who booked it.
describe('the booking confirmation', () => {
  it('states a consultation fee payable at the clinic', () => {
    expect(confirmationFee('consultation', 100_000)).toBe('₹1,000, payable at the clinic');
    expect(confirmationFee('consultation', null)).toBe('payable at the clinic');
  });

  it('leaves any other appointment to the plan', () => {
    expect(confirmationFee('treatment_session', 150_000)).toBe('as per your treatment plan');
    expect(confirmationFee('review', null)).toBe('as per your treatment plan');
  });

  it('gives the map link for directions, else the address, else the front desk', () => {
    expect(confirmationDirections('https://maps.app.goo.gl/test', '1 Test Road')).toBe(
      'https://maps.app.goo.gl/test',
    );
    expect(confirmationDirections(null, '1 Test Road')).toBe('1 Test Road');
    expect(confirmationDirections(null, null)).toBe('please ask the front desk');
  });

  it('goes as the WhatsApp template only for a WhatsApp booking', () => {
    expect(confirmationTemplateKey('whatsapp')).toBe('booking_confirmation');
    for (const channel of ['front_desk', 'walk_in', 'automatic'] as const) {
      expect(confirmationTemplateKey(channel)).toBe('front_desk_booking_confirmation');
    }
  });
});
