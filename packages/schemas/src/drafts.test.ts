import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { draftSaveRequestSchema, draftSaveResponseSchema } from './drafts';

const note = z.object({ text: z.string().max(10) });

describe('draft save schemas', () => {
  it('accepts a save with a version to compare against', () => {
    expect(draftSaveRequestSchema(note).parse({ value: { text: 'Hi' }, baseVersion: 3 })).toEqual({
      value: { text: 'Hi' },
      baseVersion: 3,
    });
  });

  it('rejects a missing or invalid base version, and an invalid value', () => {
    const request = draftSaveRequestSchema(note);
    expect(request.safeParse({ value: { text: 'Hi' } }).success).toBe(false);
    expect(request.safeParse({ value: { text: 'Hi' }, baseVersion: 0 }).success).toBe(false);
    expect(request.safeParse({ value: { text: 'far too long' }, baseVersion: 1 }).success).toBe(
      false,
    );
  });

  it('tells a save apart from a conflict, which carries the saved value', () => {
    const response = draftSaveResponseSchema(note);
    expect(response.parse({ status: 'saved', version: 4 })).toEqual({
      status: 'saved',
      version: 4,
    });
    expect(response.safeParse({ status: 'conflict', version: 4 }).success).toBe(false);
    expect(
      response.parse({ status: 'conflict', version: 4, value: { text: 'Theirs' } }),
    ).toMatchObject({ status: 'conflict', value: { text: 'Theirs' } });
  });
});
