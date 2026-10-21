import type { ReactNode } from 'react';
import { OfflineBar } from '../../../lib/drafts/offline-bar';
import { ServiceWorkerRegistration } from './service-worker';

// The staff app (/app): installable, with an offline page cached for when there is no signal
// (FND-07). Signed in pages are in (signed-in); sign in and password reset in (auth).
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OfflineBar />
      {children}
      <ServiceWorkerRegistration />
    </>
  );
}
