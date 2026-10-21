'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for the staff app (public/sw.js), in production builds only.
 * The script URL carries the build's commit, so each deployment installs a fresh shell;
 * `updateViaCache: 'none'` makes the browser check sw.js itself on every visit.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const version = encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID ?? 'local');
    navigator.serviceWorker
      .register(`/sw.js?v=${version}`, { scope: '/app', updateViaCache: 'none' })
      .catch(() => {
        // The app still works without offline support; nothing to tell the user.
      });
  }, []);
  return null;
}
