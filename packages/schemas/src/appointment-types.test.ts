import { describe, expect, it } from 'vitest';
import {
  appointmentTypeDetailsSchema,
  appointmentTypeKey,
  fitsSlots,
  formatMinutes,
  physioLengthsSchema,
  slotMessage,
} from './appointment-types';

const staffUserId = '00000000-0000-4000-8000-000000000201';
const typeId = '00000000-0000-4000-8000-000000000601';

// SET-03 done when: length per type and per physio.
describe('appointment types', () => {
  it('take a name and a length in minutes', () => {
    expect(appointmentTypeDetailsSchema.parse({ name: ' Review ', minutes: '45' })).toEqual({
      name: 'Review',
      minutes: 45,
    });
    for (const bad of [
      { name: '', minutes: '45' },
      { name: '45', minutes: '45' },
      { name: 'Review', minutes: '' },
      { name: 'Review', minutes: '0' },
      { name: 'Review', minutes: '45.5' },
      { name: 'Review', minutes: 'forty five' },
      { name: 'Review', minutes: '481' },
    ]) {
      expect(appointmentTypeDetailsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('fit lengths to the calendar slots', () => {
    expect(fitsSlots(45, 15)).toBe(true);
    expect(fitsSlots(60, 15)).toBe(true);
    expect(fitsSlots(50, 15)).toBe(false);
    expect(fitsSlots(0, 15)).toBe(false);
    expect(fitsSlots(50, 10)).toBe(true);
    expect(slotMessage(15)).toBe('Use steps of 15 minutes, for example 45.');
  });

  it('show lengths the way people say them', () => {
    expect(formatMinutes(30)).toBe('30 minutes');
    expect(formatMinutes(60)).toBe('1 hour');
    expect(formatMinutes(90)).toBe('1 hour 30 minutes');
    expect(formatMinutes(120)).toBe('2 hours');
  });

  it('make a stable key from the name', () => {
    expect(appointmentTypeKey('Zero Gravity Treadmill')).toBe('zero_gravity_treadmill');
    expect(appointmentTypeKey('6 week review')).toBe('item_6_week_review');
  });

  it('take a physio’s own lengths, blank meaning the type’s', () => {
    expect(
      physioLengthsSchema.parse({
        staffUserId,
        lengths: [
          { appointmentTypeId: typeId, minutes: '60' },
          { appointmentTypeId: typeId, minutes: '' },
        ],
      }),
    ).toEqual({
      staffUserId,
      lengths: [
        { appointmentTypeId: typeId, minutes: 60 },
        { appointmentTypeId: typeId, minutes: null },
      ],
    });
    expect(
      physioLengthsSchema.safeParse({
        staffUserId,
        lengths: [{ appointmentTypeId: typeId, minutes: '0' }],
      }).success,
    ).toBe(false);
  });
});
