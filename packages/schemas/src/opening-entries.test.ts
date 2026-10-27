import { describe, expect, it } from 'vitest';
import { addDays, istDate } from './ist';
import { openingEntryCorrectionSchema, openingEntrySchema } from './opening-entries';

const centreId = '00000000-0000-4000-8000-000000000101';
const physioId = '00000000-0000-4000-8000-000000000208';
const today = istDate(new Date());
const entry = {
  name: ' Test Patient ',
  phone: '98765 43210',
  centreId,
  physioId,
  sessionsLeft: 6,
  validUntil: addDays(today, 30),
};
const messageOf = (input: Record<string, unknown>) =>
  openingEntrySchema.safeParse({ ...entry, ...input }).error?.issues[0]?.message;

// SCH-13 (user decisions 27 October 2026): name, mobile, centre, physio, sessions left and the
// package expiry, today or later.
describe('an opening entry', () => {
  it('reads the patient, physio, sessions left and expiry', () => {
    expect(openingEntrySchema.parse(entry)).toEqual({
      ...entry,
      name: 'Test Patient',
      phone: '+919876543210',
      confirmNewPerson: false,
    });
    expect(openingEntrySchema.safeParse({ ...entry, validUntil: today }).success).toBe(true);
  });

  it('says what is wrong in words', () => {
    expect(messageOf({ sessionsLeft: 0 })).toBe('Enter at least 1 session left.');
    expect(messageOf({ sessionsLeft: 101 })).toBe('Enter at most 100 sessions left.');
    expect(messageOf({ sessionsLeft: 2.5 })).toBe('Enter the sessions left as a whole number.');
    expect(messageOf({ validUntil: addDays(today, -1) })).toBe(
      'The package expiry is in the past.',
    );
    expect(messageOf({ physioId: '' })).toBe('Choose the physio.');
    expect(messageOf({ name: ' ' })).toBe('Enter the patient’s name.');
    expect(
      openingEntryCorrectionSchema.safeParse({
        entryId: centreId,
        physioId,
        sessionsLeft: Number.NaN,
        validUntil: today,
      }).error?.issues[0]?.message,
    ).toBe('Enter the sessions left as a whole number.');
  });
});
