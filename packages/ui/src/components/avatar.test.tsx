import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, initialsOf } from './avatar';

describe('Avatar', () => {
  it('takes the first letters of the first and last names', () => {
    expect(initialsOf('Asha Rao')).toBe('AR');
    expect(initialsOf('  ravi  kumar sharma ')).toBe('RS');
    expect(initialsOf('Sneha')).toBe('S');
    expect(initialsOf('')).toBe('');
  });

  it('is initials on a sunken circle with a hairline, 32 px by default', () => {
    const html = renderToStaticMarkup(<Avatar name="Asha Rao" />);
    expect(html).toContain(
      'rounded-full border border-line bg-surface-sunken font-semibold text-ink-secondary',
    );
    expect(html).toContain('size-8 text-sm');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('>AR</span>');
  });

  it.each([
    [24, 'size-6 text-axis'],
    [48, 'size-12 text-md'],
  ] as const)('is %s px', (size, expected) => {
    expect(renderToStaticMarkup(<Avatar name="Asha Rao" size={size} />)).toContain(expected);
  });

  it('is read as the name when it stands alone', () => {
    const html = renderToStaticMarkup(<Avatar name="Asha Rao" decorative={false} />);
    expect(html).toContain('role="img" aria-label="Asha Rao"');
    expect(html).not.toContain('aria-hidden');
  });
});
