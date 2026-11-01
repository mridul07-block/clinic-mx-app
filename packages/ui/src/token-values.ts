/**
 * Token values for places that cannot read CSS variables: the web app manifest, the browser
 * theme colour, generated icons and PDF documents (ALT-05). Each must equal its token in
 * styles/tokens.css; the design check (pnpm check:design) fails if one drifts. Add a token here
 * only when a non-CSS consumer needs it.
 */
export const tokenValues = {
  canvas: '#f5f7f9',
  surface: '#ffffff',
  ink: '#0f1a24',
  'ink-secondary': '#334252',
  'ink-muted': '#4a5868',
  'ink-faint': '#66737f',
  brand: '#fcb714',
} as const;

export type TokenValueName = keyof typeof tokenValues;
