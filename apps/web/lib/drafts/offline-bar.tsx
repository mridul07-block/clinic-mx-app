'use client';

import { useOnline } from './use-online';

/** The slim offline bar (Frontend Specification section 9): "Offline, changes will sync". */
export function OfflineBar() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 border-b border-waiting-line bg-waiting-soft px-4 py-1.5 text-center text-sm font-medium text-waiting"
    >
      Offline, changes will sync
    </div>
  );
}
