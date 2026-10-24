import {
  consultationSectionsSchema,
  draftSaveResponseSchema,
  testHarnessNoteSchema,
  type DraftSaveResponse,
} from '@clinic-mx/schemas';
import type { z } from 'zod';
import type { DraftSaver } from './controller';
import type { DraftSavers } from './sync';

/**
 * Sends a draft to a save endpoint: `PUT url` with `{ value, baseVersion }`, answered with
 * `{ status: 'saved' }` or `{ status: 'conflict' }`. Rejects when the request cannot be made, so
 * the draft waits on the device.
 */
export function jsonSaver<S extends z.ZodType>(
  url: (id: string) => string,
  value: S,
): (id: string) => DraftSaver<z.infer<S>> {
  const response = draftSaveResponseSchema(value);
  return (id) => async (draft, baseVersion) => {
    const res = await fetch(url(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: draft, baseVersion }),
    });
    if (!res.ok && res.status !== 409) throw new Error(`Save failed with ${res.status}`);
    return response.parse(await res.json()) as DraftSaveResponse<z.infer<S>>;
  };
}

/** The autosave test harness note (its endpoint answers only in end to end test builds). */
export const saveTestHarnessNote = jsonSaver(
  (id) => `/api/test-harness/notes/${encodeURIComponent(id)}`,
  testHarnessNoteSchema,
);

/** A consultation's sections (CLN-02). */
export const saveConsultationDraft = jsonSaver(
  (id) => `/app/consultations/${encodeURIComponent(id)}/save`,
  consultationSectionsSchema,
);

/**
 * Savers by draft kind, used to save drafts whose screen is closed. Each screen that autosaves
 * adds its kind here.
 */
export const draftSavers: DraftSavers = {
  consultation: (id) => (value, baseVersion) =>
    saveConsultationDraft(id)(consultationSectionsSchema.parse(value), baseVersion),
  'test-harness-note': (id) => (value, baseVersion) =>
    saveTestHarnessNote(id)(testHarnessNoteSchema.parse(value), baseVersion),
};
