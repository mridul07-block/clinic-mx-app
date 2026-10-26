import { describe, expect, it } from 'vitest';
import { istInstant } from './ist';
import {
  closeTaskSchema,
  nextUnsignedNotesRun,
  takeTaskSchema,
  taskKindLabel,
  unsignedNotesOf,
  unsignedNotesTitle,
} from './tasks';

const taskId = '6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';

// ALT-03: closing a task needs a written decision.
describe('task inputs', () => {
  it('refuses a close without a decision, or with only spaces', () => {
    for (const decision of ['', '   ']) {
      const result = closeTaskSchema.safeParse({ taskId, decision });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('Write the decision before closing.');
    }
  });

  it('keeps a decision, trimmed, up to 1000 characters', () => {
    expect(closeTaskSchema.parse({ taskId, decision: '  Called back  ' }).decision).toBe(
      'Called back',
    );
    expect(closeTaskSchema.safeParse({ taskId, decision: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('refuses a task id that is not one', () => {
    expect(takeTaskSchema.safeParse({ taskId: 'not-an-id' }).success).toBe(false);
    expect(takeTaskSchema.parse({ taskId })).toEqual({ taskId });
  });

  it('names known kinds and falls back for new ones', () => {
    expect(taskKindLabel('job.failed')).toBe('Background job failed');
    expect(taskKindLabel('call.no_show')).toBe('Call after a no show');
    expect(taskKindLabel('review.no_shows')).toBe('Clinical review: missed appointments');
    expect(taskKindLabel('something.new')).toBe('Task');
  });
});

// CLN-10: the flag runs every night at 9 PM IST, queued one night ahead by the night before.
describe('the unsigned notes flag', () => {
  it('runs next tonight before 9 PM, tomorrow after it, and never on or before its own night', () => {
    expect(nextUnsignedNotesRun(istInstant('2026-11-02', 20 * 60), '2026-11-01')).toEqual({
      date: '2026-11-02',
      runAt: istInstant('2026-11-02', 21 * 60),
    });
    expect(nextUnsignedNotesRun(istInstant('2026-11-02', 21 * 60), '2026-11-02').date).toBe(
      '2026-11-03',
    );
    // On time: the run at 9 PM queues tomorrow.
    expect(nextUnsignedNotesRun(istInstant('2026-11-02', 21 * 60 + 1), '2026-11-02').date).toBe(
      '2026-11-03',
    );
    // Late after downtime: it catches up to tonight, not every missed night.
    expect(nextUnsignedNotesRun(istInstant('2026-11-09', 10 * 60), '2026-11-02').date).toBe(
      '2026-11-09',
    );
    // Run early (a test queues a night ahead): still the night after its own.
    expect(nextUnsignedNotesRun(istInstant('2026-11-02', 10 * 60), '2026-11-05').date).toBe(
      '2026-11-06',
    );
  });

  it('names the count and centre, and reads its notes back', () => {
    expect(unsignedNotesTitle(3, 'HSR Layout')).toBe('Unsigned notes: 3 at HSR Layout');
    expect(unsignedNotesTitle(1, 'Whitefield')).toBe('Unsigned note: 1 at Whitefield');
    expect(taskKindLabel('review.unsigned_notes')).toBe('Unsigned notes');
    const note = {
      kind: 'session',
      number: 'MVH-00012',
      physio: 'Test Physio',
      startsAt: '2026-11-02T04:30:00.000Z',
    };
    expect(unsignedNotesOf({ date: '2026-11-02', notes: [note] })).toEqual([note]);
    expect(unsignedNotesOf({ notes: [{ ...note, kind: 'other' }] })).toEqual([]);
    expect(unsignedNotesOf({})).toEqual([]);
  });
});
