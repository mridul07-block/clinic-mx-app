import type { Problem } from './problems';
import { contrast, luminance, type Tokens } from './tokens';

const surfaces = ['canvas', 'surface', 'surface-subtle', 'surface-hover', 'surface-sunken'];
const statuses = ['info', 'waiting', 'active', 'done', 'danger'];

/** Text needs 4.5:1 (WCAG 1.4.3): [foreground, background]. */
export const textPairs: [string, string][] = [
  ...['ink', 'ink-secondary', 'ink-muted'].flatMap((ink) =>
    surfaces.map((bg): [string, string] => [ink, bg]),
  ),
  ...statuses.flatMap((tone): [string, string][] => [
    [tone, `${tone}-soft`],
    [tone, 'surface'],
  ]),
  ['ink', 'accent-soft'],
  ['on-accent', 'accent'],
  ['on-accent', 'accent-hover'],
  ['on-brand', 'brand'],
  ['on-danger', 'danger-strong'],
];

/** Control borders, the focus ring, icons and chart marks need 3:1 (WCAG 1.4.11). */
export const markPairs: [string, string][] = [
  'line-control',
  'focus',
  'brand-deep',
  'waiting-strong',
  'danger-strong',
  'viz-1',
  'viz-target',
  'viz-centre-1',
  'viz-centre-2',
  'viz-centre-3',
  'viz-promoter',
  'viz-detractor',
].map((mark): [string, string] => [mark, 'surface']);

const rampSteps = [1, 2, 3, 4, 5, 6, 7].map((n) => `viz-ramp-${n}`);

/** Checks every pair above and the heatmap ramp against the tokens in `file`. */
export function checkTokens(tokens: Tokens, file: string): Problem[] {
  const problems: Problem[] = [];
  const report = (rule: string, message: string) => {
    problems.push({ file, line: 1, rule, message });
  };

  const check = (pairs: [string, string][], min: number, rule: string) => {
    for (const [fg, bg] of pairs) {
      const a = tokens.get(fg);
      const b = tokens.get(bg);
      if (!a || !b) {
        report(rule, `token --${a ? bg : fg} is missing`);
        continue;
      }
      const ratio = contrast(a, b);
      if (ratio < min) {
        report(rule, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
    }
  };
  check(textPairs, 4.5, 'text-contrast');
  check(markPairs, 3, 'mark-contrast');

  const ramp = rampSteps.map((step) => tokens.get(step));
  for (let i = 1; i < ramp.length; i++) {
    const previous = ramp[i - 1];
    const current = ramp[i];
    if (!previous || !current) {
      report('heatmap-ramp', `token --${rampSteps[previous ? i : i - 1] ?? ''} is missing`);
    } else if (luminance(current) >= luminance(previous)) {
      report('heatmap-ramp', `--${rampSteps[i] ?? ''} is not darker than the step before it`);
    }
  }
  return problems;
}
