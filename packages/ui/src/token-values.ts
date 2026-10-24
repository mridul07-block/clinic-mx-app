/**
 * Token values for places that cannot read CSS variables: the web app manifest, the browser
 * theme colour, generated icons and PDF documents (ALT-05). Each must equal its token in
 * styles/tokens.css; the design check (pnpm check:design) fails if one drifts. Add a token here
 * only when a non-CSS consumer needs it.
 */
export const tokenValues = {
  canvas: '#f7f5f3',
  surface: '#ffffff',
  ink: '#1b1915',
  'ink-secondary': '#45423d',
  'ink-muted': '#66635d',
  'ink-faint': '#8f8c86',
  brand: '#fcb714',
} as const;

export type TokenValueName = keyof typeof tokenValues;
