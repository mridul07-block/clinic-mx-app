import { LIVE_HEADER } from './live';

/**
 * Live screens hear about changes within 2 seconds (FND-09; TAD section 8; docs/runbooks/
 * live-relay.md). One socket per tab to the realtime relay, which says only which centres changed;
 * each screen then checks for changes through its own permission checked route, as it does on its
 * own every few seconds. While the socket is up the screens' own checks slow to every
 * `live.connected_check_seconds`; while it is down they run every `live.refresh_seconds`, as
 * before the relay (user decision, 31 October 2026).
 */

/** The parts of a WebSocket the relay uses, so tests can stand one in. */
export interface RelaySocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/** Where to connect and the token to connect with; null when the relay is not set up. */
export interface RelayTicket {
  url: string;
  token: string;
}

export interface RelayDeps {
  ticket: () => Promise<RelayTicket | null>;
  open: (url: string) => RelaySocket;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  now: () => number;
}

/** How long before the next attempt after `failures` failed ones: 1, 2, 4 … 30 seconds. */
export function reconnectDelaySeconds(failures: number): number {
  return Math.min(30, 2 ** Math.max(0, failures));
}

/** A socket heard nothing (not even a pong) for this long is treated as gone. */
const SILENT_MS = 60_000;
const PING_MS = 25_000;

export class LiveRelay {
  private socket: RelaySocket | null = null;
  private failures = 0;
  private stopped = false;
  private retry: unknown = null;
  private pinger: unknown = null;
  private heardAt = 0;
  private live = false;
  private readonly signalListeners = new Set<(centres: readonly string[]) => void>();
  private readonly stateListeners = new Set<(connected: boolean) => void>();

  constructor(private readonly deps: RelayDeps) {}

  get connected(): boolean {
    return this.live;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.deps.clearTimeout(this.retry);
    this.deps.clearTimeout(this.pinger);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setLive(false);
  }

  /** Called with the centres that changed (only centres the person sees). */
  onSignal(listener: (centres: readonly string[]) => void): () => void {
    this.signalListeners.add(listener);
    return () => this.signalListeners.delete(listener);
  }

  onState(listener: (connected: boolean) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    for (const listener of this.stateListeners) listener(live);
  }

  private async connect(): Promise<void> {
    let ticket: RelayTicket | null;
    try {
      ticket = await this.deps.ticket();
    } catch {
      this.again();
      return;
    }
    // Not set up here (or signed out): the screens keep checking on their own.
    if (!ticket || this.stopped) return;
    const url = new URL('/connect', ticket.url);
    url.searchParams.set('token', ticket.token);
    const socket = this.deps.open(url.toString());
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.failures = 0;
      this.heardAt = this.deps.now();
      this.setLive(true);
      this.ping(socket);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.heardAt = this.deps.now();
      if (event.data === 'pong') return;
      const centres = changedCentres(event.data);
      if (centres.length === 0) return;
      for (const listener of this.signalListeners) listener(centres);
    };
    const lost = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.deps.clearTimeout(this.pinger);
      this.setLive(false);
      this.again();
    };
    socket.onclose = lost;
    socket.onerror = lost;
  }

  private again(): void {
    if (this.stopped) return;
    const delay = reconnectDelaySeconds(this.failures) * 1000;
    this.failures += 1;
    this.retry = this.deps.setTimeout(() => void this.connect(), delay);
  }

  /** Every 25 s a ping (answered by the relay); a socket silent for a minute is closed. */
  private ping(socket: RelaySocket): void {
    this.pinger = this.deps.setTimeout(() => {
      if (this.socket !== socket) return;
      if (this.deps.now() - this.heardAt > SILENT_MS) {
        socket.close();
        socket.onclose?.();
        return;
      }
      try {
        socket.send('ping');
      } catch {
        // Closing; onclose reconnects.
      }
      this.ping(socket);
    }, PING_MS);
  }
}

function changedCentres(data: unknown): string[] {
  if (typeof data !== 'string') return [];
  try {
    const { centres } = JSON.parse(data) as { centres?: unknown };
    return Array.isArray(centres)
      ? centres.filter((centre): centre is string => typeof centre === 'string')
      : [];
  } catch {
    return [];
  }
}

export interface LiveTimers {
  setInterval: (run: () => void, ms: number) => unknown;
  clearInterval: (timer: unknown) => void;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

const browserTimers: LiveTimers = {
  setInterval: (run, ms) => globalThis.setInterval(run, ms),
  clearInterval: (timer) => {
    globalThis.clearInterval(timer as ReturnType<typeof setInterval>);
  },
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (timer) => {
    globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

/** Signals close together run one check. */
export const SIGNAL_DEBOUNCE_MS = 200;

/**
 * Runs a screen's live check on its own (every `connectedSeconds` while the relay is connected,
 * every `refreshSeconds` while it is not, or when there is no relay), and at once when the relay
 * says one of `centres` changed (any centre for `'any'`). Returns the stop.
 */
export function scheduleLiveChecks(
  relay: LiveRelay | null,
  check: () => unknown,
  options: {
    refreshSeconds: number;
    connectedSeconds: number;
    centres: readonly string[] | 'any';
    timers?: LiveTimers;
  },
): () => void {
  const timers = options.timers ?? browserTimers;
  let interval: unknown = null;
  let pending: unknown = null;
  const every = (connected: boolean) => {
    timers.clearInterval(interval);
    const seconds = connected ? options.connectedSeconds : options.refreshSeconds;
    interval = timers.setInterval(() => void check(), seconds * 1000);
  };
  every(relay?.connected ?? false);
  const offState = relay?.onState(every);
  const offSignal = relay?.onSignal((changed) => {
    const mine =
      options.centres === 'any' || changed.some((centre) => options.centres.includes(centre));
    if (!mine || pending !== null) return;
    pending = timers.setTimeout(() => {
      pending = null;
      void check();
    }, SIGNAL_DEBOUNCE_MS);
  });
  return () => {
    timers.clearInterval(interval);
    timers.clearTimeout(pending);
    offState?.();
    offSignal?.();
  };
}

/** Asks the app for a ticket to the relay (FND-09): null when it is not set up or signed out. */
export async function fetchRelayTicket(): Promise<RelayTicket | null> {
  const response = await fetch('/app/live/relay', {
    headers: { [LIVE_HEADER]: '1' },
    cache: 'no-store',
  });
  if (response.status === 204 || response.status === 401) return null;
  if (!response.ok) throw new Error(['relay ticket', String(response.status)].join(' '));
  return (await response.json()) as RelayTicket;
}
