import { describe, expect, it } from 'vitest';
import { consultationFeeSchema, slotOptionsQuerySchema } from './calendar';

// SCH-05: a consultant's fee is a price item or none; a picked slot is a physio and a start.
describe('calendar', () => {
  const staffUserId = '00000000-0000-4000-8000-000000000207';
  it('takes a price item for the fee, or empty for none', () => {
    const priceItemId = '00000000-0000-4000-8000-000000000701';
    expect(consultationFeeSchema.parse({ staffUserId, priceItemId })).toEqual({
      staffUserId,
      priceItemId,
    });
    expect(consultationFeeSchema.parse({ staffUserId, priceItemId: '' }).priceItemId).toBeNull();
    expect(consultationFeeSchema.safeParse({ staffUserId, priceItemId: 'senior' }).success).toBe(
      false,
    );
  });

  it('reads a picked slot from the address', () => {
    const picked = slotOptionsQuerySchema.parse({
      centreId: '00000000-0000-4000-8000-000000000101',
      physioId: staffUserId,
      startsAt: '2026-11-02T05:00:00.000Z',
    });
    expect(picked.startsAt).toEqual(new Date('2026-11-02T05:00:00.000Z'));
  });
});
