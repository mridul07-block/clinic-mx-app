'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LiveRelay, fetchRelayTicket, type RelaySocket } from './live-relay';

/**
 * The tab's one connection to the realtime relay (FND-09), for every live screen on the page.
 * Off (null) where the relay is not set up: the screens then check on their own every
 * `live.refresh_seconds`, as before.
 */
interface LiveRelayValue {
  relay: LiveRelay | null;
  /** `live.connected_check_seconds`. */
  connectedSeconds: number;
}

const LiveRelayContext = createContext<LiveRelayValue>({ relay: null, connectedSeconds: 15 });

function openSocket(url: string): RelaySocket {
  return new WebSocket(url) as unknown as RelaySocket;
}

export function LiveRelayProvider({
  enabled,
  connectedSeconds,
  children,
}: {
  enabled: boolean;
  connectedSeconds: number;
  children: ReactNode;
}) {
  const [relay] = useState(() =>
    enabled
      ? new LiveRelay({
          ticket: fetchRelayTicket,
          open: openSocket,
          setTimeout: (run, ms) => window.setTimeout(run, ms),
          clearTimeout: (timer) => {
            window.clearTimeout(timer as number);
          },
          now: () => Date.now(),
        })
      : null,
  );
  useEffect(() => {
    relay?.start();
    return () => {
      relay?.stop();
    };
  }, [relay]);
  return <LiveRelayContext value={{ relay, connectedSeconds }}>{children}</LiveRelayContext>;
}

/** The relay (null when off) and how often to check while it is connected. */
export function useLiveRelay(): LiveRelayValue {
  return useContext(LiveRelayContext);
}
