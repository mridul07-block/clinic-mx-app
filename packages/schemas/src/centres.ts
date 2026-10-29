import { z } from 'zod';

/**
 * Centres (SET-01, TAD section 3): name, address, map link, phone and chart colour per centre.
 * Decisions (user, 22 October 2026): the Super Admin adds, edits and deactivates centres (never
 * deletes them); a centre's colour is one of the design system's reserved centre colours, each
 * used by one active centre at a time.
 */

/**
 * The design system's centre colours (`viz-centre-1..3`, Frontend Specification section 2.4), in
 * token order; the design check fails if a value drifts from its token. Charts only.
 */
export const centreColours = [
  { name: 'Blue', value: '#2F74BB' },
  { name: 'Violet', value: '#7F5BB6' },
  { name: 'Teal', value: '#1C8580' },
] as const;

export type CentreColour = (typeof centreColours)[number]['value'];

const colourValues = centreColours.map((colour) => colour.value) as [
  CentreColour,
  ...CentreColour[],
];

/** The colour's name, for words beside every swatch (status is never colour alone). */
export function centreColourName(value: string): string {
  return centreColours.find((colour) => colour.value === value)?.name ?? value;
}

/** Which of the reserved colours a value is, 0 to 2, for its token class; -1 when none. */
export function centreColourIndex(value: string): number {
  return centreColours.findIndex((colour) => colour.value === value);
}

const phoneMessage = 'Enter a 10 digit Indian phone number, for example 080 4123 4567.';

/**
 * An Indian phone number as people type it (spaces, dashes, a leading 0 or +91), stored as
 * E.164: +91 and 10 digits. Mobiles start 6 to 9; landlines carry their area code.
 */
export const indianPhoneSchema = z
  .string()
  .trim()
  .transform((typed) => typed.replace(/[\s().-]/g, ''))
  .transform((digits) => digits.replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ''))
  .pipe(z.string().regex(/^[1-9]\d{9}$/, { error: phoneMessage }))
  .transform((national) => `+91${national}`);

/** A stored phone number as people read it: +91 98450 12345, or +91 80 4123 4567 in Bengaluru. */
export function formatIndianPhone(e164: string): string {
  const national = e164.replace(/^\+91/, '');
  if (!/^\d{10}$/.test(national)) return e164;
  if (national.startsWith('80')) {
    return `+91 80 ${national.slice(2, 6)} ${national.slice(6)}`;
  }
  return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
}

const mapsHosts = new Set(['maps.app.goo.gl', 'google.com', 'www.google.com', 'maps.google.com']);

/**
 * A Google Maps link to the centre. Patients open it from WhatsApp and My plan, so only https
 * Google Maps addresses are accepted.
 */
export const mapLinkSchema = z
  .string()
  .trim()
  .refine(
    (text) => {
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        return false;
      }
      if (url.protocol !== 'https:' || url.username || url.password) return false;
      if (url.hostname === 'goo.gl') return url.pathname.startsWith('/maps');
      if (url.hostname === 'google.com' || url.hostname === 'www.google.com') {
        return url.pathname.startsWith('/maps');
      }
      return mapsHosts.has(url.hostname);
    },
    { error: 'Paste the Google Maps link to the centre (it starts with https://).' },
  );

const reviewHosts = new Set(['g.page', 'search.google.com', 'maps.app.goo.gl']);

/**
 * The centre's Google review link (PAT-09; PRD J7.3: "Google review requests"): sent to every
 * discharged patient. Only https Google review addresses are accepted (DECISION PAT-09).
 */
export const reviewLinkSchema = z
  .string()
  .trim()
  .refine(
    (text) => {
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        return false;
      }
      if (url.protocol !== 'https:' || url.username || url.password) return false;
      if (url.hostname === 'google.com' || url.hostname === 'www.google.com') {
        return url.pathname.startsWith('/maps') || url.pathname.startsWith('/search');
      }
      return reviewHosts.has(url.hostname);
    },
    { error: 'Paste the centre’s Google review link (it starts with https://).' },
  );

/** A centre's details, as the Super Admin enters them. */
export const centreDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter the centre’s name.' })
    .max(60, { error: 'Keep the name under 60 characters.' }),
  address: z
    .string()
    .trim()
    .min(1, { error: 'Enter the centre’s address.' })
    .max(300, { error: 'Keep the address under 300 characters.' }),
  phone: indianPhoneSchema,
  mapLink: mapLinkSchema,
  /** PAT-09: optional until the clinic has it; empty clears it. */
  reviewLink: z
    .string()
    .trim()
    .optional()
    .transform((text) => (text === undefined ? undefined : text === '' ? null : text))
    .pipe(reviewLinkSchema.nullable().optional()),
  colour: z.enum(colourValues, { error: 'Choose the centre’s chart colour.' }),
});

export type CentreDetails = z.output<typeof centreDetailsSchema>;

/**
 * A centre's short code, the start of every OP number it issues (SCH-01, user decision 22 October
 * 2026): 2 to 4 capital letters, for example HSR. Fixed once the centre is added.
 */
export const centreCodeSchema = z
  .string()
  .trim()
  .transform((typed) => typed.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2,4}$/, { error: 'Enter 2 to 4 letters, for example HSR.' }));

/**
 * A centre's appointment ID prefix (SCH-04, decision G6: MVH, MVK, MVW), for example MVK-00042:
 * 2 to 4 capital letters, fixed once the centre is added.
 */
export const appointmentPrefixSchema = z
  .string()
  .trim()
  .transform((typed) => typed.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2,4}$/, { error: 'Enter 2 to 4 letters, for example MVH.' }));

/** How many Zero Gravity Treadmills a centre has (decision G2: machines are resources). */
export const treadmillsSchema = z.coerce
  .number({ error: 'Enter a whole number, 0 or more.' })
  .int({ error: 'Enter a whole number, 0 or more.' })
  .min(0, { error: 'Enter a whole number, 0 or more.' })
  .max(20, { error: 'Enter 20 or fewer.' });

/** Adding a centre: its details, its code and its appointment prefix. */
export const newCentreSchema = centreDetailsSchema.extend({
  code: centreCodeSchema,
  appointmentPrefix: appointmentPrefixSchema,
  treadmills: treadmillsSchema,
});

export type NewCentreDetails = z.output<typeof newCentreSchema>;

/** Editing a centre: which one, and its details (the code and prefix never change). */
export const centreUpdateSchema = centreDetailsSchema.extend({
  centreId: z.guid(),
  treadmills: treadmillsSchema,
});

export type CentreUpdate = z.output<typeof centreUpdateSchema>;

/** Deactivating or reactivating a centre. */
export const centreActiveSchema = z.object({ centreId: z.guid(), active: z.boolean() });
