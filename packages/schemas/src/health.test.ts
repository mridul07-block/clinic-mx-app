import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './health';

const healthy = { status: 'ok', commit: 'abc1234', region: 'bom1', environment: 'preview' };

describe('healthResponseSchema', () => {
  it('accepts a healthy response', () => {
    expect(healthResponseSchema.parse(healthy).region).toBe('bom1');
  });

  it('rejects any status other than ok', () => {
    expect(healthResponseSchema.safeParse({ ...healthy, status: 'down' }).success).toBe(false);
  });

  it('rejects empty commit and region', () => {
    expect(healthResponseSchema.safeParse({ ...healthy, commit: '', region: '' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown environment', () => {
    expect(healthResponseSchema.safeParse({ ...healthy, environment: 'qa' }).success).toBe(false);
  });
});
