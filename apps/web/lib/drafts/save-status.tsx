'use client';

import type { DraftStatus } from './controller';
import { useOnline } from './use-online';

const words: Record<DraftStatus, string | null> = {
  idle: null,
  saving: 'Saving',
  saved: 'Saved',
  pending: 'Not saved yet',
  conflict: 'Not saved',
};

/**
 * The quiet autosave word beside a section title (Frontend Specification section 9: "Saved").
 * Offline, the bar at the top says the rest ("Offline, changes will sync").
 */
export function SaveStatus({ status }: { status: DraftStatus }) {
  const online = useOnline();
  const word = status === 'pending' && !online ? 'Saved on this device' : words[status];
  return (
    <span role="status" aria-live="polite" className="text-sm text-ink-muted">
      {word}
    </span>
  );
}
