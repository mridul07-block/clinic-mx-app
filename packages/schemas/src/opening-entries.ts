import { z } from 'zod';
import { calendarDateSchema, istDate } from './ist';
import { patientDetailsSchema } from './patients';

/**
 * Opening entries (SCH-13, PRD section 3 phase 5 and section 10; user decisions 27 October 2026;
 * docs/runbooks/opening-entries.md): a patient already in treatment on launch day is entered by
 * the Super Admin with their name, mobile, centre, physio, the sessions left on their package and
 * its expiry. The entry opens an Active episode and an opening package with no bill, so sessions
 * start, close and use it as usual; numbering starts again from launch. Entries can be made and
 * corrected (until the package is first used) while `launch.opening_entries_open` is on.
 */

export const OPENING_SESSIONS_MAX = 100;

const sessionsLeft = z
  .int({ error: 'Enter the sessions left as a whole number.' })
  .min(1, { error: 'Enter at least 1 session left.' })
  .max(OPENING_SESSIONS_MAX, {
    error: `Enter at most ${String(OPENING_SESSIONS_MAX)} sessions left.`,
  });

/** The package's last usable day, in IST: today or later. */
const validUntil = calendarDateSchema.refine((date) => date >= istDate(new Date()), {
  error: 'The package expiry is in the past.',
});

export const openingEntrySchema = patientDetailsSchema.pick({ name: true, phone: true }).extend({
  centreId: z.guid({ error: 'Choose the centre.' }),
  physioId: z.guid({ error: 'Choose the physio.' }),
  sessionsLeft,
  validUntil,
  confirmNewPerson: z.boolean().default(false),
});
export type OpeningEntryInput = z.output<typeof openingEntrySchema>;

/** A correction while the opening package is unused: the physio, sessions left and expiry. */
export const openingEntryCorrectionSchema = z.object({
  entryId: z.guid(),
  physioId: z.guid({ error: 'Choose the physio.' }),
  sessionsLeft,
  validUntil,
});
export type OpeningEntryCorrection = z.output<typeof openingEntryCorrectionSchema>;

/** Opening or closing entries (the setting `launch.opening_entries_open`). */
export const openingEntriesSwitchSchema = z.object({ open: z.boolean() });

/** The name every opening package carries. */
export const OPENING_PACKAGE_NAME = 'Opening package';
