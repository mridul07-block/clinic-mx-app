import { z } from 'zod';
import type { EpisodeStatus } from './episodes';
import { reassessmentEntrySchema } from './reassessment';

/**
 * Final testing (OUT-07, PRD J6.2; user decisions 27 October 2026): on the episode's Review and
 * discharge screen, anyone with the Consultant tick retests exactly the frozen baseline's measures
 * (OUT-01), both sides of a side by side one, each recorded or Not tested with a reason, and signs
 * it once. Recording is signing; it never changes after. The entries and their gate are the
 * session 4 reassessment's (`./reassessment`).
 */

/** Final testing as the consultant signs it: an entry per baseline measure, by measure key. */
export const finalTestSchema = z.object({
  episodeId: z.guid(),
  entries: z
    .record(
      z
        .string()
        .regex(/^[a-z_]+\.[a-z0-9_.]+$/)
        .max(120),
      reassessmentEntrySchema,
    )
    .refine((entries) => Object.keys(entries).length <= 100, 'Too many measures.'),
});
export type FinalTestInput = z.infer<typeof finalTestSchema>;

/** Final testing is signed while the patient is in treatment: Active or Under review. */
export const takesFinalTest = (status: EpisodeStatus) =>
  status === 'active' || status === 'under_review';
