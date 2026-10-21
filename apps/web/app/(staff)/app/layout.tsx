import type { ReactNode } from 'react';
import { ServiceWorkerRegistration } from './service-worker';

// The staff app (/app): installable, with its shell cached for offline use (FND-07).
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ServiceWorkerRegistration />
    </>
  );
}
