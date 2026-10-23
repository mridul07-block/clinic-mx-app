import { tokenValues } from '@clinic-mx/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { fontClasses } from './fonts';
import './globals.css';

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
    <html lang="en" className={fontClasses}>
      <body>{children}</body>
    </html>
  );
}
