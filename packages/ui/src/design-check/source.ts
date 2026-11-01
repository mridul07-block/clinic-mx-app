import type { Problem } from './problems';

/**
 * Source rules (Frontend Specification section 10, design system v3 section 13): colours come
 * only from tokens.css, gold is never text, Tailwind's default palette and bold do not exist,
 * strong status tones are never text, shadcn's token names and dead radius or shadow utilities
 * are refused, and class names are written out in full so Tailwind can see them.
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
const rules: {
  rule: string;
  pattern: RegExp;
  message: string;
  skipRawColour?: boolean;
  /** Apply the rule only to files whose path matches. */
  onlyIn?: RegExp;
}[] = [
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
    rule: 'strong-as-text',
    // The strong tones are for dots, marks and the emergency fill (design system v3 section
    // 2.3): waiting-strong on its tint is 3.4:1, below the 4.5:1 text needs.
    pattern: /(?<![\w-])(?:[\w-]+:)*text-[a-z]+-strong(?:\/\d+)?(?![\w-])/g,
    message: 'a strong status tone is for marks and fills, never text; use the plain tone',
  },
  {
    rule: 'shadcn-name',
    // shadcn/ui's token names (UIX-06 ports its recipes): under our theme they generate nothing,
    // and `accent` means our teal, not shadcn's quiet hover. Rewrite them to our tokens.
    pattern: new RegExp(
      `(?<![\\w-])(?:[\\w-]+:)*(?:${colourUtilities})-(?:(?:primary|secondary|muted|popover|card|destructive|accent|sidebar)-foreground|primary|foreground|background|muted|popover|card|input|ring|destructive|sidebar(?:-[a-z]+)*)(?:\\/\\d+)?(?![\\w-])|(?<![\\w-])dark:`,
      'g',
    ),
    message:
      "shadcn's token name; use ours (docs/design/README.md section 8: bg-accent, text-ink, bg-surface, text-ink-muted, border-line-control)",
  },
  {
    rule: 'dead-utility',
    // Tailwind's own radii and shadows are removed (theme.css), so these generate nothing.
    // Bare `rounded` and `shadow` are left alone: they are ordinary words in strings.
    pattern:
      /(?<![\w-])(?:[\w-]+:)*(?:rounded-(?:(?:[trbl]|tl|tr|br|bl|[se]|ss|se|es|ee)(?:-(?:xs|sm|md|lg|xl|[234]xl))?|xs|sm|md|lg|xl|[234]xl)|shadow-(?:sm|md|lg|xl|2xl|inner))(?![\w-])/g,
    message:
      'generates nothing under our theme; use a token radius (rounded-control, -tag, -panel, -sheet, -drawer, -full) or shadow (shadow-xs, -float, -drawer)',
  },
  {
    rule: 'dynamic-class',
    pattern: /(?<![\w-])(?:[\w-]+:)*-?[a-z]+(?:-[a-z0-9]+)*-\$\{/g,
    message: 'class name built at run time; Tailwind cannot see it. Write it out in full',
    // Class names live in TypeScript; plain JS (the service worker, configs) has none, and
    // its `name-${x}` strings are cache keys and the like.
    onlyIn: /\.tsx?$/,
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
  for (const { rule, pattern, message, skipRawColour, onlyIn } of rules) {
    if (skipRawColour && allowRawColour) continue;
    if (onlyIn && !onlyIn.test(file)) continue;
    lines.forEach((content, index) => {
      for (const match of content.matchAll(pattern)) {
        problems.push({ file, line: index + 1, rule, message: `${match[0]}: ${message}` });
      }
    });
  }
  return problems;
}
