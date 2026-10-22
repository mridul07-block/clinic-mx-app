import { describe, expect, it } from 'vitest';
import { bookNewPatientSchema, consultationFeeSchema, slotOptionsQuerySchema } from './calendar';

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

  // SCH-07: a new caller needs a name and a mobile only.
  const choice = {
    centreId: '00000000-0000-4000-8000-000000000101',
    physioId: staffUserId,
    appointmentTypeId: '00000000-0000-4000-8000-000000000601',
    startsAt: '2026-11-02T05:00:00.000Z',
  };

  it('books a new caller with a name and a mobile only', () => {
    const parsed = bookNewPatientSchema.parse({
      ...choice,
      name: ' Test Caller ',
      phone: '98450 12345',
    });
    expect(parsed).toMatchObject({
      name: 'Test Caller',
      phone: '+919845012345',
      confirmNewPerson: false,
    });
    expect(
      bookNewPatientSchema.safeParse({ ...choice, name: '', phone: '98450 12345' }).success,
    ).toBe(false);
    expect(
      bookNewPatientSchema.safeParse({ ...choice, name: 'Test Caller', phone: '' }).success,
    ).toBe(false);
  });
});
