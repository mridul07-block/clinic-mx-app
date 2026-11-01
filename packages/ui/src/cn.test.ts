import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cn, themeColours, themeRadii, themeShadows, themeTextSizes } from './cn';

describe('cn', () => {
  it('keeps a type size and a colour side by side', () => {
    expect(cn('text-title text-ink')).toBe('text-title text-ink');
    expect(cn('text-base text-on-accent')).toBe('text-base text-on-accent');
    expect(cn('text-display text-waiting')).toBe('text-display text-waiting');
  });

  it('lets a later colour, size, radius or shadow win', () => {
    expect(cn('bg-accent', 'bg-surface')).toBe('bg-surface');
    expect(cn('text-ink', 'text-ink-muted')).toBe('text-ink-muted');
    expect(cn('text-base', 'text-md')).toBe('text-md');
    expect(cn('rounded-control', 'rounded-panel')).toBe('rounded-panel');
    expect(cn('shadow-xs', 'shadow-float')).toBe('shadow-float');
    expect(cn('border-line-control', 'border-danger')).toBe('border-danger');
  });

  it('keeps variants apart', () => {
    expect(cn('bg-accent hover:bg-accent-hover')).toBe('bg-accent hover:bg-accent-hover');
    expect(cn('h-row pointer-coarse:h-row-touch')).toBe('h-row pointer-coarse:h-row-touch');
  });

  it('drops falsy parts', () => {
    expect(cn('px-3', false, undefined, null, 'py-2')).toBe('px-3 py-2');
  });
});

describe('cn theme lists', () => {
  const theme = readFileSync(join(import.meta.dirname, 'styles', 'theme.css'), 'utf8');
  const names = (prefix: string) =>
    // eslint-disable-next-line security/detect-non-literal-regexp -- prefix is one of four constants below
    [...theme.matchAll(new RegExp(String.raw`^\s*--${prefix}-([\w-]+?)(?:--[\w-]+)?:`, 'gm'))]
      .map(([, name]) => name)
      .filter((name): name is string => Boolean(name) && name !== '*');
  const unique = (list: string[]) => [...new Set(list)];

  it('match the colours, sizes, radii and shadows in theme.css', () => {
    expect(unique(names('color'))).toEqual(themeColours);
    expect(unique(names('text'))).toEqual(themeTextSizes);
    expect(unique(names('radius'))).toEqual(themeRadii);
    expect(unique(names('shadow'))).toEqual(themeShadows);
  });
});
