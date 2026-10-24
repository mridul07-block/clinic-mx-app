import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkTokens } from './contrast';
import type { Problem } from './problems';
import { tokenValues } from '../token-values';
import { checkSource } from './source';
import { parseTokens } from './tokens';

// `pnpm check:design`: the design token check (Frontend Specification section 10). Exits 1 and
// prints file:line for every broken rule.

const root = join(import.meta.dirname, '..', '..', '..', '..');
const tokensFile = 'packages/ui/src/styles/tokens.css';
const tokenValuesFile = 'packages/ui/src/token-values.ts';
const seedFile = 'packages/db/src/seed/data.ts';
const centreColoursFile = 'packages/schemas/src/centres.ts';

/**
 * Files the raw colour rule skips: the tokens themselves, and mirrors checked against them below
 * (token values for non-CSS consumers, the seed's centre colours, and the centre colours a Super
 * Admin chooses from, SET-01); and the brand logo's own colours, generated from its SVG for the
 * PDF letterhead (ALT-05).
 */
const rawColourAllowed = new Set([
  tokensFile,
  tokenValuesFile,
  seedFile,
  centreColoursFile,
  'apps/web/modules/documents/logo-paths.ts',
]);

/** Tests that name forbidden values on purpose, to prove the page or theme lacks them. */
const testsOfTheRules = new Set([
  // Compares computed colours on the page with the token values.
  'apps/web/e2e/design.spec.ts',
  // Asserts Tailwind's default palette and bold generate nothing.
  'packages/ui/src/theme.test.ts',
  // Proves a colour outside the reserved centre colours is refused (SET-01).
  'packages/schemas/src/centres.test.ts',
]);

/** The check's own folder holds the rules and their failing fixtures. */
const skipped = (file: string) =>
  file.startsWith('packages/ui/src/design-check/') || testsOfTheRules.has(file);

const skipDirs = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);

function* sourceFiles(dir: string): Generator<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks this repository's own apps/ and packages/ folders
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) yield* sourceFiles(join(dir, entry.name));
    } else if (/\.(?:tsx?|jsx?|mjs|cjs|css)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      yield join(dir, entry.name);
    }
  }
}

const tokens = parseTokens(readFileSync(join(root, tokensFile), 'utf8'));
const problems: Problem[] = checkTokens(tokens, tokensFile);
let scanned = 0;

for (const top of ['apps', 'packages']) {
  for (const path of sourceFiles(join(root, top))) {
    const file = relative(root, path).split(sep).join('/');
    if (skipped(file)) continue;
    scanned++;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file found by the walk above
    problems.push(...checkSource(file, readFileSync(path, 'utf8'), rawColourAllowed.has(file)));
  }
}

// Token values used outside CSS (manifest, icons) must equal tokens.css.
for (const [name, value] of Object.entries(tokenValues)) {
  if (value !== tokens.get(name)) {
    problems.push({
      file: tokenValuesFile,
      line: 1,
      rule: 'token-value',
      message: `${name} is ${value} but --${name} is ${tokens.get(name) ?? 'missing'}`,
    });
  }
}

// The seed stores each centre's chart colour as data; it must match the tokens, in order.
const seedColours = [...readFileSync(join(root, seedFile), 'utf8').matchAll(/colour: '(#\w+)'/g)];
seedColours.forEach(([, colour], i) => {
  const token = `viz-centre-${i + 1}`;
  if (colour?.toLowerCase() !== tokens.get(token)) {
    problems.push({
      file: seedFile,
      line: 1,
      rule: 'centre-colour',
      message: `centre ${i + 1} colour ${colour ?? ''} differs from --${token}`,
    });
  }
});

// The centre colours a Super Admin chooses from (SET-01) must be the centre tokens, in order.
const choosable = [
  ...readFileSync(join(root, centreColoursFile), 'utf8').matchAll(/value: '(#\w+)'/g),
];
if (choosable.length !== 3) {
  problems.push({
    file: centreColoursFile,
    line: 1,
    rule: 'centre-colour',
    message: `expected the 3 centre colours, found ${String(choosable.length)}`,
  });
}
choosable.forEach(([, colour], i) => {
  const token = `viz-centre-${String(i + 1)}`;
  if (colour?.toLowerCase() !== tokens.get(token)) {
    problems.push({
      file: centreColoursFile,
      line: 1,
      rule: 'centre-colour',
      message: `centre colour ${String(i + 1)} ${colour ?? ''} differs from --${token}`,
    });
  }
});

for (const p of problems) console.error(`${p.file}:${p.line}  ${p.rule}  ${p.message}`);
console.log(
  problems.length
    ? `Design check failed: ${problems.length} problem(s) in ${scanned} files.`
    : `Design check passed: ${tokens.size} colour tokens, ${scanned} files.`,
);
process.exitCode = problems.length ? 1 : 0;
