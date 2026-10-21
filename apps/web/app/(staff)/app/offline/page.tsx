import type { Metadata } from 'next';
import { ReloadButton } from './reload-button';

export const metadata: Metadata = { title: 'Offline · Clinic Mx' };

// Shown by the service worker when a staff page is opened without a connection and is not
// part of the cached shell.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 py-6">
      <h1 className="text-title font-semibold">You are offline</h1>
      <p className="text-ink-secondary">
        This page needs a connection. Check your Wi-Fi or mobile data, then try again.
      </p>
      <ReloadButton />
    </main>
  );
}
