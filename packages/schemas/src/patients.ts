import { z } from 'zod';
import { indianPhoneSchema } from './centres';
import { calendarDateSchema, istDate } from './ist';

/**
 * Patients (SCH-01, PRD M1, TAD section 4): records are keyed by person, not phone number, so a
 * family can share one mobile; every centre sees every patient (PRD J7.6). A new patient needs a
 * name and a mobile only; the rest is optional until the health form. The OP number is issued by
 * the database from the registering centre's sequence (`HSR-00042`) and never changes.
 * Decisions (user, 22 October 2026): sex is female, male or other; a mobile already on file shows
 * its patients before another person is added to it.
 */

export const patientSexes = ['female', 'male', 'other'] as const;

export type PatientSex = (typeof patientSexes)[number];

export const patientSexLabels: Record<PatientSex, string> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
};

/** An optional form field: an empty box means not given. */
const optional = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

const optionalText = (max: number, label: string) =>
  optional(
    z
      .string()
      .trim()
      .max(max, { error: `Keep the ${label} under ${max} characters.` })
      .transform((text) => text || undefined),
  );

/** The earliest date of birth accepted, against typing slips such as 0985. */
const EARLIEST_BIRTH = '1900-01-01';

export const dateOfBirthSchema = calendarDateSchema
  .refine((date) => date >= EARLIEST_BIRTH, { error: 'Check the year of birth.' })
  .refine((date) => date <= istDate(new Date()), { error: 'The date of birth is in the future.' });

/** A patient's name and contact details, as staff enter them. */
export const patientDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter the patient’s name.' })
    .max(100, { error: 'Keep the name under 100 characters.' }),
  phone: indianPhoneSchema,
  email: optional(
    z
      .string()
      .trim()
      .pipe(z.email({ error: 'Enter an email address like name@example.com.' })),
  ),
  dateOfBirth: optional(dateOfBirthSchema),
  sex: optional(z.enum(patientSexes, { error: 'Choose female, male or other.' })),
  occupation: optionalText(100, 'occupation'),
});

export type PatientDetails = z.output<typeof patientDetailsSchema>;

/**
 * Adding a patient: their details, the centre registering them (it issues the OP number), and
 * whether staff confirmed a new person on a mobile already on file.
 */
export const newPatientSchema = patientDetailsSchema.extend({
  registeredCentreId: z.guid({ error: 'Choose the centre.' }),
  confirmNewPerson: z.boolean().default(false),
});

export type NewPatient = z.output<typeof newPatientSchema>;

/** Editing a patient's details; the OP number and registering centre never change. */
export const patientUpdateSchema = patientDetailsSchema.extend({ patientId: z.guid() });

/** What a patient search looks for: part of a mobile number, or part of a name. */
export type PatientSearch = { kind: 'phone'; digits: string } | { kind: 'name'; text: string };

/** The fewest characters a search needs, so one letter does not list everyone. */
const SEARCH_MIN = 2;

/**
 * Reads a search box: digits (with spaces, dashes or +91) search mobiles, anything else names.
 * Undefined when there is too little to search.
 */
export function patientSearch(typed: string): PatientSearch | undefined {
  const text = typed.trim().replace(/\s+/g, ' ');
  if (text.length < SEARCH_MIN) return undefined;
  if (/^[+\d\s().-]+$/.test(text)) {
    const digits = text.replace(/\D/g, '').replace(/^(0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
    return digits.length < SEARCH_MIN ? undefined : { kind: 'phone', digits };
  }
  return { kind: 'name', text };
}

/**
 * Guardians (SCH-02, PRD J2.7): a patient under the adult age (setting `patients.adult_age_years`)
 * needs a guardian, who signs and attends. Decisions (user, 22 October 2026): several guardians per
 * patient; the relationship is one of a fixed list; a patient without one is flagged, not blocked
 * (the consent gate, INT-07, needs a guardian to sign).
 */
export const guardianRelationships = [
  'mother',
  'father',
  'legal_guardian',
  'other_relative',
] as const;

export type GuardianRelationship = (typeof guardianRelationships)[number];

export const guardianRelationshipLabels: Record<GuardianRelationship, string> = {
  mother: 'Mother',
  father: 'Father',
  legal_guardian: 'Legal guardian',
  other_relative: 'Other relative',
};

/** A guardian's details, as staff enter them. */
export const guardianDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter the guardian’s name.' })
    .max(100, { error: 'Keep the name under 100 characters.' }),
  relationship: z.enum(guardianRelationships, {
    error: 'Choose how they are related to the patient.',
  }),
  phone: indianPhoneSchema,
});

export type GuardianDetails = z.output<typeof guardianDetailsSchema>;

export const newGuardianSchema = guardianDetailsSchema.extend({ patientId: z.guid() });

export const guardianUpdateSchema = guardianDetailsSchema.extend({ guardianId: z.guid() });

export const guardianRemoveSchema = z.object({ guardianId: z.guid() });

/** Whole years from a date of birth to a date (both `YYYY-MM-DD`, IST calendar dates). */
export function ageOn(dateOfBirth: string, date: string): number {
  const [by = 0, bm = 0, bd = 0] = dateOfBirth.split('-').map(Number);
  const [y = 0, m = 0, d = 0] = date.split('-').map(Number);
  // Born on 29 February: the birthday counts from 1 March in other years.
  const hadBirthday = m > bm || (m === bm && d >= bd);
  return y - by - (hadBirthday ? 0 : 1);
}

/** Whether a patient of this age needs a guardian; unknown (no date of birth) is not flagged. */
export function needsGuardian(age: number | null, adultAge: number): boolean {
  return age !== null && age < adultAge;
}
