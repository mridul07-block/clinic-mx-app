import { describe, expect, it } from 'vitest';
import { closeTaskSchema, takeTaskSchema, taskKindLabel } from './tasks';

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
