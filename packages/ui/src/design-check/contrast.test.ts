import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTokens } from './contrast';
import { contrast, parseTokens } from './tokens';

const tokens = parseTokens(
  readFileSync(join(import.meta.dirname, '..', 'styles', 'tokens.css'), 'utf8'),
);

describe('tokens.css', () => {
  it('has the Movementology gold from the logo file (Frontend Specification section 2)', () => {
    expect(tokens.get('brand')).toBe('#fcb714');
  });

  it('passes every contrast pair and the heatmap ramp', () => {
    expect(checkTokens(tokens, 'tokens.css')).toEqual([]);
  });

  it('keeps gold below text contrast on white, which is why it is never text', () => {
    expect(contrast(tokens.get('brand') ?? '', tokens.get('surface') ?? '')).toBeLessThan(4.5);
  });

  it('resolves aliases such as --warning', () => {
    expect(tokens.get('warning')).toBe(tokens.get('waiting'));
  });
});

describe('checkTokens', () => {
  it('fails a text pair below 4.5:1', () => {
    const weak = new Map(tokens).set('ink-muted', '#b0aca6');
    expect(checkTokens(weak, 't').map((p) => p.rule)).toContain('text-contrast');
  });

  it('fails a ramp that does not darken', () => {
    const flat = new Map(tokens).set('viz-ramp-5', tokens.get('viz-ramp-3') ?? '');
    expect(checkTokens(flat, 't').map((p) => p.rule)).toContain('heatmap-ramp');
  });

  it('reports a missing token', () => {
    const missing = new Map(tokens);
    missing.delete('focus');
    expect(checkTokens(missing, 't')).toEqual([
      expect.objectContaining({ message: 'token --focus is missing' }),
    ]);
  });
});

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });
});
