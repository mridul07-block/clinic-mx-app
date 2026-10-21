/**
 * Token values for places that cannot read CSS variables: the web app manifest, the browser
 * theme colour and generated icons. Each must equal its token in styles/tokens.css; the
 * design check (pnpm check:design) fails if one drifts. Add a token here only when a non-CSS
 * consumer needs it.
 */
export const tokenValues = {
  canvas: '#f7f5f3',
  surface: '#ffffff',
  ink: '#1b1915',
} as const;

export type TokenValueName = keyof typeof tokenValues;
