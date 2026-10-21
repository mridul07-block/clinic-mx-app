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
