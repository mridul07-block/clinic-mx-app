'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { LIVE_HEADER } from '../../../../lib/live';
import { scheduleLiveChecks } from '../../../../lib/live-relay';
import { useLiveRelay } from '../../../../lib/live-relay-context';

/**
 * Keeps the emergency banners current on every page (ALT-01): checks the open emergencies every
 * `live.refresh_seconds` and draws the page again when they change, so a new emergency appears
 * and an acknowledged one goes without anyone navigating.
 */
export function EmergencyWatch({
  alertIds,
  refreshSeconds,
}: {
  alertIds: readonly string[];
  refreshSeconds: number;
}) {
  const router = useRouter();
  const shown = alertIds.join(',');
  const current = useRef(shown);

  useEffect(() => {
    current.current = shown;
  }, [shown]);

  const { relay, connectedSeconds } = useLiveRelay();

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch('/app/alerts/live', {
          headers: { [LIVE_HEADER]: '1' },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const answer = (await response.json()) as { alertIds: string[] };
        if (!stopped && answer.alertIds.join(',') !== current.current) router.refresh();
      } catch {
        // Offline: the banners stay as they are until the next check.
      }
    };
    // FND-09: at once when the realtime relay says a centre changed; on its own otherwise.
    const stop = scheduleLiveChecks(relay, check, {
      refreshSeconds,
      connectedSeconds,
      centres: 'any',
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [refreshSeconds, router, relay, connectedSeconds]);

  return null;
}
