'use client';

import { useEffect } from 'react';
import { draftSavers } from './savers';
import { flushDrafts } from './sync';
import { useDraftScope } from './use-autosave';

/**
 * Mounted once in the staff app: saves every waiting draft when the app opens and whenever the
 * connection returns, including drafts whose screen is closed.
 */
export function DraftSync() {
  const scope = useDraftScope();
  useEffect(() => {
    const flush = () => {
      if (navigator.onLine) void flushDrafts(scope, draftSavers);
    };
    flush();
    window.addEventListener('online', flush);
    return () => {
      window.removeEventListener('online', flush);
    };
  }, [scope]);
  return null;
}
