import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

// Compiles the same stylesheet the app uses, then asks Tailwind which classes exist.
const styles = import.meta.dirname + '/styles';
const css = ['tokens', 'theme', 'base', 'motion', 'hatch']
  .map((name) => `@import './${name}.css';`)
  .join('\n');

async function generates(candidate: string): Promise<boolean> {
  const compiler = await compile(`@import 'tailwindcss/utilities';\n${css}`, {
    base: styles,
    onDependency: () => undefined,
  });
  return compiler.build([candidate]).includes(`.${candidate.replace(/[:/]/g, '\\$&')}`);
}

describe('Tailwind theme', () => {
  it.each(['bg-canvas', 'text-ink', 'border-line-control', 'rounded-panel', 'text-title', 'h-row'])(
    'has the token utility %s',
    async (candidate) => {
      expect(await generates(candidate)).toBe(true);
    },
  );

  it.each(['bg-red-500', 'text-white', 'font-bold', 'rounded-lg', 'shadow-md', 'text-lg/7'])(
    'removes the Tailwind default %s',
    async (candidate) => {
      expect(await generates(candidate)).toBe(false);
    },
  );
});

describe('font-mono (design system v3, UIX-04)', () => {
  it('is Inter with tabular figures and ss02, not a second font', async () => {
    const compiler = await compile(`@import 'tailwindcss/utilities';\n${css}`, {
      base: styles,
      onDependency: () => undefined,
    });
    const rule = compiler.build(['font-mono']);
    expect(rule).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(rule).toMatch(/font-feature-settings:\s*'tnum',\s*'ss02'/);
  });
});
