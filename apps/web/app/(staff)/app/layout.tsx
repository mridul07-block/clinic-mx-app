import type { ReactNode } from 'react';
import { DraftSync } from '../../../lib/drafts/draft-sync';
import { OfflineBar } from '../../../lib/drafts/offline-bar';
import { ServiceWorkerRegistration } from './service-worker';

// The staff app (/app): installable, with its shell cached for offline use (FND-07); drafts are
// kept on the device and saved when the connection returns (FND-08).
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OfflineBar />
      {children}
      <ServiceWorkerRegistration />
      <DraftSync />
    </>
  );
}
