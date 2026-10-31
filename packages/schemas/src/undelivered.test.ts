import { describe, expect, it } from 'vitest';
import { followUpUndeliveredSchema, messageLabel, undeliveredReason } from './undelivered';

// WA-13: the front desk reads why WhatsApp could not deliver a message, in plain words, and which
// message it was.
describe('a message that was not delivered', () => {
  it('says why in plain words, keeping the code when it is not one we know', () => {
    expect(undeliveredReason('131026')).toBe('Not on WhatsApp, or cannot receive messages');
    expect(undeliveredReason('131047')).toBe('More than 24 hours since they last wrote to us');
    expect(undeliveredReason('131049')).toBe('WhatsApp held it back');
    expect(undeliveredReason('131050')).toBe('WhatsApp held it back');
    expect(undeliveredReason('131031')).toMatch(/tell the Super Admin$/);
    expect(undeliveredReason('132001')).toBe('A template problem: tell the Super Admin');
    expect(undeliveredReason('131000')).toBe('WhatsApp could not deliver it (code 131000)');
    expect(undeliveredReason(null)).toBe('WhatsApp could not deliver it');
  });

  it('names the message as the desk knows it', () => {
    expect(messageLabel('booking_confirmation')).toBe('Booking confirmation');
    expect(messageLabel('day_before_reminder')).toBe('Day before reminder');
    expect(messageLabel('emergency_advice')).toBe('Emergency advice');
    expect(messageLabel('menu')).toBe('Menu');
    expect(messageLabel('something_else')).toBe('A WhatsApp message');
    expect(messageLabel(null)).toBe('A WhatsApp message');
  });

  it('takes Done for a message and the board’s centre', () => {
    expect(followUpUndeliveredSchema.safeParse({ messageId: 'x', centreId: 'y' }).success).toBe(
      false,
    );
  });
});
