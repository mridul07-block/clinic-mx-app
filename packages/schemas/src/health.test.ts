import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('accepts a healthy response', () => {
    const parsed = healthResponseSchema.parse({ status: 'ok', commit: 'abc1234', region: 'bom1' });
    expect(parsed.region).toBe('bom1');
  });

  it('rejects any status other than ok', () => {
    const result = healthResponseSchema.safeParse({ status: 'down', commit: 'x', region: 'y' });
    expect(result.success).toBe(false);
  });

  it('rejects empty commit and region', () => {
    const result = healthResponseSchema.safeParse({ status: 'ok', commit: '', region: '' });
    expect(result.success).toBe(false);
  });
});
