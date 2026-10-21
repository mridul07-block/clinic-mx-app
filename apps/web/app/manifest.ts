import { tokenValues } from '@clinic-mx/ui';
import type { MetadataRoute } from 'next';

/**
 * Web app manifest: staff install Clinic Mx on phones, tablets and desktops (PRD section 8, TAD
 * section 2). The scope is the staff app only, so patient pages (/p/...) are never offered as
 * an install.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/app',
    name: 'Clinic Mx',
    short_name: 'Clinic Mx',
    description: 'Clinic management for Movementology Clinics',
    start_url: '/app',
    scope: '/app',
    display: 'standalone',
    orientation: 'any',
    lang: 'en',
    background_color: tokenValues.canvas,
    theme_color: tokenValues.canvas,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
