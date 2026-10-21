import { describe, expect, it } from 'vitest';
import { checkSource, stripComments } from './source';

const rulesIn = (text: string, allowRawColour = false) =>
  checkSource('fixture.tsx', text, allowRawColour).map((p) => p.rule);

describe('raw colours', () => {
  it.each([
    `<div style={{ color: '#ff0000' }} />`,
    `<div className="bg-[#fcb714]" />`,
    `const shadow = 'rgb(0 0 0 / 10%)';`,
    `.x { background: oklch(70% 0.1 80); }`,
    `.x { color: #FFF; }`,
  ])('fails on %s', (text) => {
    expect(rulesIn(text)).toContain('raw-colour');
  });

  it.each([
    `<a href="#main">Skip to page</a>`,
    `this.#cache = new Map();`,
    `<div className="bg-canvas text-ink" />`,
    `.x { color: var(--ink); }`,
  ])('passes %s', (text) => {
    expect(rulesIn(text)).toEqual([]);
  });

  it('is skipped where colours are allowed', () => {
    expect(rulesIn(`--brand: #fcb714;`, true)).toEqual([]);
  });
});

describe('gold text', () => {
  it.each([
    `<h1 className="text-brand">`,
    `<h1 className="hover:text-brand">`,
    `.x { color: var(--brand); }`,
  ])('fails on %s', (text) => {
    expect(rulesIn(text)).toContain('gold-text');
  });

  it.each([`<Icon className="text-brand-deep" />`, `<div className="bg-brand text-on-brand" />`])(
    'passes %s',
    (text) => {
      expect(rulesIn(text)).toEqual([]);
    },
  );
});

describe("Tailwind's default palette and weights", () => {
  it.each([
    `<div className="bg-red-500" />`,
    `<p className="text-white" />`,
    `<p className="md:border-gray-200/50" />`,
    `<b className="font-bold" />`,
  ])('fails on %s', (text) => {
    expect(rulesIn(text).some((r) => r === 'default-palette' || r === 'font-weight')).toBe(true);
  });

  it.each([`<div className="bg-surface-sunken border-line-control font-semibold" />`])(
    'passes %s',
    (text) => {
      expect(rulesIn(text)).toEqual([]);
    },
  );
});

describe('dynamic class names', () => {
  it.each(['const c = `bg-${tone}`;', 'className={`border-${tone}-line rounded-tag`}'])(
    'fails on %s',
    (text) => {
      expect(rulesIn(text)).toContain('dynamic-class');
    },
  );

  it('passes full names chosen at run time', () => {
    expect(rulesIn('className={`rounded-tag ${active ? "bg-accent" : "bg-surface"}`}')).toEqual([]);
  });
});

describe('comments', () => {
  it('are ignored, keeping line numbers', () => {
    const text = '/* bg-red-500 and\n font-bold do nothing */\nconst a = "#fff";';
    expect(stripComments(text).split('\n')).toHaveLength(3);
    expect(checkSource('f.ts', text)).toEqual([expect.objectContaining({ line: 3 })]);
  });

  it('keep URLs in strings', () => {
    expect(stripComments(`const u = 'https://example.test';`)).toContain('https://example.test');
  });
});
