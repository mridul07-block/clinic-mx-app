import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

// Self hosted at build time and preloaded. latin-ext carries the rupee sign (₹).
const plexSans = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: 'variable',
  display: 'swap',
  variable: '--font-plex-sans',
});

// Plex Mono only for patient IDs, appointment IDs and bill numbers.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
});

/** On <html> in the root layout and the app's error page, which replaces it. */
export const fontClasses = `${plexSans.variable} ${plexMono.variable}`;
