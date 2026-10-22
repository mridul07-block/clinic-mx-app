import { describe, expect, it } from 'vitest';
import { centreCodeSchema, centreColours, newCentreSchema } from './centres';
import { addDays, istDate } from './ist';
import {
  ageOn,
  guardianDetailsSchema,
  needsGuardian,
  newPatientSchema,
  patientDetailsSchema,
  patientSearch,
} from './patients';

// SCH-01: patients keyed by person; a new patient needs a name and a mobile only.
const centreId = '00000000-0000-4000-8000-000000000101';

describe('patient details', () => {
  it('needs only a name and a mobile, stored as +91 and 10 digits', () => {
    const parsed = patientDetailsSchema.parse({
      name: '  Test Patient ',
      phone: '99000 00001',
      email: '',
      dateOfBirth: '',
      sex: '',
      occupation: '  ',
    });
    expect(parsed).toEqual({ name: 'Test Patient', phone: '+919900000001' });
  });

  it('keeps the optional details when given', () => {
    const parsed = patientDetailsSchema.parse({
      name: 'Test Patient',
      phone: '+91 99000 00001',
      email: 'patient@example.test',
      dateOfBirth: '1990-04-12',
      sex: 'other',
      occupation: 'Runner',
    });
    expect(parsed).toMatchObject({ dateOfBirth: '1990-04-12', sex: 'other', occupation: 'Runner' });
  });

  it('refuses a missing name, a bad mobile, a bad email and an unknown sex', () => {
    const result = patientDetailsSchema.safeParse({
      name: ' ',
      phone: '12345',
      email: 'not an email',
      sex: 'unknown',
    });
    expect(result.success).toBe(false);
    const fields = result.error?.issues.map((issue) => issue.path.join('.'));
    expect(fields).toEqual(expect.arrayContaining(['name', 'phone', 'email', 'sex']));
  });

  it('refuses a date of birth in the future or before 1900', () => {
    const tomorrow = addDays(istDate(new Date()), 1);
    expect(
      patientDetailsSchema.safeParse({ name: 'A', phone: '9900000001', dateOfBirth: tomorrow })
        .success,
    ).toBe(false);
    expect(
      patientDetailsSchema.safeParse({ name: 'A', phone: '9900000001', dateOfBirth: '0985-01-01' })
        .success,
    ).toBe(false);
    expect(
      patientDetailsSchema.safeParse({
        name: 'A',
        phone: '9900000001',
        dateOfBirth: istDate(new Date()),
      }).success,
    ).toBe(true);
  });

  it('adds a patient at a centre, a new person only when confirmed', () => {
    const parsed = newPatientSchema.parse({
      name: 'Test Patient',
      phone: '9900000001',
      registeredCentreId: centreId,
    });
    expect(parsed.confirmNewPerson).toBe(false);
    expect(newPatientSchema.safeParse({ name: 'A', phone: '9900000001' }).success).toBe(false);
  });
});

describe('patient search', () => {
  it('searches mobiles for digits, however they are typed', () => {
    expect(patientSearch('99000')).toEqual({ kind: 'phone', digits: '99000' });
    expect(patientSearch('+91 99000 00001')).toEqual({ kind: 'phone', digits: '9900000001' });
    expect(patientSearch('099000-00001')).toEqual({ kind: 'phone', digits: '9900000001' });
  });

  it('searches names for anything else, and needs two characters', () => {
    expect(patientSearch('  test   pat ')).toEqual({ kind: 'name', text: 'test pat' });
    expect(patientSearch('a')).toBeUndefined();
    expect(patientSearch('  ')).toBeUndefined();
    expect(patientSearch('+')).toBeUndefined();
  });
});

describe('centre codes', () => {
  it('are 2 to 4 letters, in capitals', () => {
    expect(centreCodeSchema.parse(' hsr ')).toBe('HSR');
    expect(centreCodeSchema.safeParse('H').success).toBe(false);
    expect(centreCodeSchema.safeParse('HSRLY').success).toBe(false);
    expect(centreCodeSchema.safeParse('H5R').success).toBe(false);
  });

  it('are needed to add a centre', () => {
    const details = {
      name: 'Test centre',
      address: 'Somewhere',
      phone: '080 4123 4567',
      mapLink: 'https://maps.app.goo.gl/abc123',
      colour: centreColours[0].value,
    };
    expect(newCentreSchema.safeParse(details).success).toBe(false);
    expect(newCentreSchema.parse({ ...details, code: 'tst' }).code).toBe('TST');
  });
});

// SCH-02: guardians for patients under the adult age.
describe('guardians', () => {
  it('need a name, a relationship from the list and a mobile', () => {
    expect(
      guardianDetailsSchema.parse({
        name: ' Test Mother ',
        relationship: 'mother',
        phone: '99000 00001',
      }),
    ).toEqual({ name: 'Test Mother', relationship: 'mother', phone: '+919900000001' });
    const result = guardianDetailsSchema.safeParse({ name: '', relationship: 'aunt', phone: '1' });
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['name', 'relationship', 'phone']),
    );
  });

  it('count whole years of age, on the IST calendar date', () => {
    expect(ageOn('2010-06-15', '2026-06-15')).toBe(16);
    expect(ageOn('2010-06-15', '2026-06-14')).toBe(15);
    expect(ageOn('2008-10-23', '2026-10-22')).toBe(17);
    expect(ageOn('2008-10-22', '2026-10-22')).toBe(18);
    // Born on 29 February: a year older from 1 March in other years.
    expect(ageOn('2012-02-29', '2026-02-28')).toBe(13);
    expect(ageOn('2012-02-29', '2026-03-01')).toBe(14);
  });

  it('are needed below the adult age, and not when the age is unknown', () => {
    expect(needsGuardian(17, 18)).toBe(true);
    expect(needsGuardian(18, 18)).toBe(false);
    expect(needsGuardian(null, 18)).toBe(false);
  });
});
