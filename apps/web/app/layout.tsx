import { tokenValues } from '@clinic-mx/ui';
import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'Clinic Mx',
  description: 'Clinic management for Movementology Clinics',
  // iPhone and iPad: open the installed app full screen, with its own name (FND-07).
  appleWebApp: { capable: true, title: 'Clinic Mx', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: tokenValues.canvas,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
