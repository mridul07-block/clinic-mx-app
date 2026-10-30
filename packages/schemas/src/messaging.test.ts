import { describe, expect, it } from 'vitest';
import {
  maskNumber,
  mayReceive,
  retryableSendFailure,
  templateSendable,
  testRecipientsSchema,
  whatsappNumberSchema,
} from './messaging';

// WA-01: messages go only where they may, and only with an approved template.
describe('WhatsApp numbers', () => {
  it('takes a number with its country code, however it is typed', () => {
    expect(whatsappNumberSchema.parse('+91 98450 12345')).toBe('+919845012345');
    expect(whatsappNumberSchema.parse('+1 (555) 647-2996')).toBe('+15556472996');
    expect(whatsappNumberSchema.safeParse('98450 12345').success).toBe(false);
    expect(whatsappNumberSchema.safeParse('+0123456789').success).toBe(false);
  });

  it('keeps the test list to the 5 numbers Meta allows', () => {
    const five = [
      '+919845012341',
      '+919845012342',
      '+919845012343',
      '+919845012344',
      '+919845012345',
    ];
    expect(testRecipientsSchema.parse(five)).toHaveLength(5);
    expect(testRecipientsSchema.safeParse([...five, '+919845012346']).success).toBe(false);
  });

  it('hides all but the last 4 digits', () => {
    expect(maskNumber('+919845012345')).toBe('••••••2345');
  });
});

describe('mayReceive', () => {
  const list = ['+919845012345'];
  it('allows only the test list while it is on, and anyone once it is off', () => {
    expect(mayReceive('+919845012345', { testRecipientsOnly: true, testRecipients: list })).toBe(
      true,
    );
    expect(mayReceive('+919999999999', { testRecipientsOnly: true, testRecipients: list })).toBe(
      false,
    );
    expect(mayReceive('+919999999999', { testRecipientsOnly: false, testRecipients: [] })).toBe(
      true,
    );
  });
});

describe('templateSendable', () => {
  it('sends no template Meta has not approved', () => {
    expect(templateSendable('booking_confirmation')).toBe(false);
  });
});

describe('retryableSendFailure', () => {
  it('tries again on no answer, a rate limit or a fault at Meta, never on a refusal', () => {
    expect(retryableSendFailure({ kind: 'network' })).toBe(true);
    expect(retryableSendFailure({ kind: 'timeout' })).toBe(true);
    expect(retryableSendFailure({ kind: 'http', httpStatus: 429 })).toBe(true);
    expect(retryableSendFailure({ kind: 'http', httpStatus: 503 })).toBe(true);
    expect(retryableSendFailure({ kind: 'http', httpStatus: 400 })).toBe(false);
    expect(retryableSendFailure({ kind: 'http', httpStatus: 401 })).toBe(false);
  });
});
