import { Inter } from 'next/font/google';

// Design system v3 (UIX-04): Inter for everything, self hosted at build time and preloaded.
// latin-ext carries the rupee sign (₹). IDs and bill numbers use the same file through
// `font-mono`, with tabular figures and Inter's `ss02` set (theme.css), so no second font loads.
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  weight: 'variable',
  display: 'swap',
  variable: '--font-inter',
});

/** On <html> in the root layout and the app's error page, which replaces it. */
export const fontClasses = inter.variable;
