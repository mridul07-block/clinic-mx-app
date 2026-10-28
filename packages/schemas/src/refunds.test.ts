import { describe, expect, it } from 'vitest';
import { refundLookupSchema, refundSchema } from './refunds';

const paymentId = '00000000-0000-4000-8000-000000000c01';

// BIL-11: Finance finds a payment by a printed number and records the amount in rupees, how it
// went back, an optional reference and why.
describe('refunds', () => {
  it('reads a bill or invoice number as printed', () => {
    expect(refundLookupSchema.parse({ number: ' hsr-b-00042 ' })).toEqual({
      number: 'HSR-B-00042',
    });
    expect(refundLookupSchema.parse({ number: 'KOR-INV-00007' })).toEqual({
      number: 'KOR-INV-00007',
    });
    expect(refundLookupSchema.safeParse({ number: 'Test Patient' }).success).toBe(false);
  });

  it('reads the amount in rupees as paise, with the reason and an optional reference', () => {
    expect(
      refundSchema.parse({
        paymentId,
        amount: '₹1,250.50',
        method: 'upi',
        reference: '  ',
        reason: ' Moved to another city ',
      }),
    ).toEqual({
      paymentId,
      amount: 125050,
      method: 'upi',
      reference: undefined,
      reason: 'Moved to another city',
    });
  });

  it('refuses no amount, no method, no reason and a long reference', () => {
    const message = (input: Record<string, string>) =>
      refundSchema.safeParse({
        paymentId,
        amount: '500',
        method: 'cash',
        reason: 'Goodwill',
        ...input,
      }).error?.issues[0]?.message;
    expect(message({ amount: '0' })).toBe('Enter an amount above ₹0.');
    expect(message({ method: '' })).toBe('Choose how the money went back.');
    expect(message({ reason: ' ' })).toBe('Say why the money is refunded.');
    expect(message({ reference: 'x'.repeat(41) })).toBe('Keep the reference to 40 characters.');
  });
});
