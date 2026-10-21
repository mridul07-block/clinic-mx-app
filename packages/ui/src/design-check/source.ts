import type { Problem } from './problems';

/**
 * Source rules (Frontend Specification section 10, design system v2 section 13): colours come
 * only from tokens.css, gold is never text, Tailwind's default palette and bold do not exist,
 * and class names are written out in full so Tailwind can see them.
 */

const tailwindPalette = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'rose', 'black', 'white',
].join('|'); // prettier-ignore

const colourUtilities = [
  'bg', 'text', 'border', 'border-[xytrblse]', 'ring', 'ring-offset', 'outline', 'fill',
  'stroke', 'decoration', 'divide', 'placeholder', 'caret', 'accent', 'shadow', 'from', 'via',
  'to',
].join('|'); // prettier-ignore

// `(?<![\w-])` and `(?![\w-])` keep matches to whole class names; `(?:[\w-]+:)*` allows
// variants such as `hover:` and `pointer-coarse:`.
/* eslint-disable security/detect-unsafe-regex, security/detect-non-literal-regexp -- every
   repeated group ends at a fixed delimiter (":" or "-"), so matching is linear; the patterns
   are built from the constant lists above and only ever read this repository's source. */
const rules: { rule: string; pattern: RegExp; message: string; skipRawColour?: boolean }[] = [
  {
    rule: 'raw-colour',
    // Hex colours (not `this.#field` or `&#123;`) and colour functions.
    pattern:
      /(?<![\w.&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab)\(/gi,
    message: 'raw colour; use a token from packages/ui/src/styles/tokens.css',
    skipRawColour: true,
  },
  {
    rule: 'gold-text',
    pattern: /(?<![\w-])(?:[\w-]+:)*text-brand(?![\w-])|(?<![\w-])color:\s*var\(--brand\)/g,
    message: 'gold is a mark and a fill, never text (1.7:1 on white)',
  },
  {
    rule: 'default-palette',
    pattern: new RegExp(
      `(?<![\\w-])(?:[\\w-]+:)*-?(?:${colourUtilities})-(?:${tailwindPalette})(?:-\\d{2,3})?(?:/\\d+)?(?![\\w-])`,
      'g',
    ),
    message: "Tailwind's default palette does not exist here; use a token colour",
  },
  {
    rule: 'font-weight',
    pattern: /(?<![\w-])(?:[\w-]+:)*font-(?:thin|extralight|light|bold|extrabold|black)(?![\w-])/g,
    message: 'only font-normal, font-medium and font-semibold exist (no bold)',
  },
  {
    rule: 'dynamic-class',
    pattern: /(?<![\w-])(?:[\w-]+:)*-?[a-z]+(?:-[a-z0-9]+)*-\$\{/g,
    message: 'class name built at run time; Tailwind cannot see it. Write it out in full',
  },
];
/* eslint-enable security/detect-unsafe-regex, security/detect-non-literal-regexp -- end of the rule patterns */

/**
 * Blanks out comments, keeping line breaks so line numbers stay right: a comment may name a
 * forbidden class to explain why it is forbidden. Line comments count only after whitespace or
 * at the start of a line, so `https://` in a string is kept.
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Problems in one source file. `allowRawColour` skips the raw colour rule only. */
export function checkSource(file: string, text: string, allowRawColour = false): Problem[] {
  const problems: Problem[] = [];
  const lines = stripComments(text).split('\n');
  for (const { rule, pattern, message, skipRawColour } of rules) {
    if (skipRawColour && allowRawColour) continue;
    lines.forEach((content, index) => {
      for (const match of content.matchAll(pattern)) {
        problems.push({ file, line: index + 1, rule, message: `${match[0]}: ${message}` });
      }
    });
  }
  return problems;
}
