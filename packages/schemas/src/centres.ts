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
  colour: z.enum(colourValues, { error: 'Choose the centre’s chart colour.' }),
});

export type CentreDetails = z.output<typeof centreDetailsSchema>;

/** Editing a centre: which one, and its details. */
export const centreUpdateSchema = centreDetailsSchema.extend({ centreId: z.guid() });

/** Deactivating or reactivating a centre. */
export const centreActiveSchema = z.object({ centreId: z.guid(), active: z.boolean() });
