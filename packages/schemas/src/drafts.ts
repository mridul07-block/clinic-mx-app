import { z } from 'zod';

/**
 * Autosave (FND-08). A screen saves a draft with the version it started from; the server saves
 * it only if the record is still at that version, otherwise it answers with the saved value so
 * the person can choose which to keep. Each screen passes the schema of its own value.
 */

export const recordVersionSchema = z.number().int().min(1);

export function draftSaveRequestSchema<T extends z.ZodType>(value: T) {
  return z.object({ value, baseVersion: recordVersionSchema });
}

export function draftSaveResponseSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('saved'), version: recordVersionSchema }),
    /** Someone saved this record since `baseVersion`; `value` is what they saved. */
    z.object({ status: z.literal('conflict'), version: recordVersionSchema, value }),
  ]);
}

/** The note edited by the autosave test harness (end to end tests only, never in production). */
export const testHarnessNoteSchema = z.object({ text: z.string().max(5000) });
export type TestHarnessNote = z.infer<typeof testHarnessNoteSchema>;

export type DraftSaveResponse<T> =
  { status: 'saved'; version: number } | { status: 'conflict'; version: number; value: T };
