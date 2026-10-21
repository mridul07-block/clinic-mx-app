import { z } from 'zod';
import {
  patientLinkDefinitions,
  patientLinkPurposes,
  type PatientLinkPurpose,
} from './patient-links';

/**
 * Tablet kiosk mode (IAM-10, PRD J2.2 and J4.4, Frontend Specification section 7): the clinic
 * tablet is set up once as its centre's kiosk; the front desk sends a patient's form to it; it
 * shows only that form and goes back to the welcome screen after a submit or when idle.
 * Decisions (user, 22 October 2026): anyone with check in rights sets a tablet up and stops it;
 * the thank you screen stays `kiosk.thank_you_seconds`.
 */

/**
 * The forms a tablet opens: the single use ones, filled in at the clinic. My plan is personal and
 * lasts weeks, so it never opens on a shared tablet.
 */
export const kioskPurposes = patientLinkPurposes.filter(
  (purpose) => patientLinkDefinitions[purpose].singleUse,
);

export function opensOnKiosk(purpose: PatientLinkPurpose): boolean {
  return kioskPurposes.includes(purpose);
}

export const KIOSK_DEFAULT_NAME = 'Front desk tablet';

/** Setting this device up as a centre's kiosk. */
export const setUpKioskSchema = z.object({
  centreId: z.guid({ error: 'Choose the centre this tablet is in.' }),
  name: z
    .string()
    .trim()
    .min(1, { error: 'Enter a name for this tablet.' })
    .max(60, { error: 'Keep the name under 60 characters.' }),
});

/** Stopping a tablet being a kiosk. */
export const stopKioskSchema = z.object({ kioskId: z.guid() });

/** Sending a patient's form to a tablet ("Open on tablet", INT-02). */
export const sendToKioskSchema = z.object({ kioskId: z.guid(), linkId: z.guid() });

/** What the tablet's welcome screen learns when it asks (`GET /kiosk/state`). */
export const kioskStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('waiting') }),
  z.object({ state: z.literal('open'), path: z.string().startsWith('/p/') }),
  z.object({ state: z.literal('ended') }),
]);

export type KioskState = z.infer<typeof kioskStateSchema>;
