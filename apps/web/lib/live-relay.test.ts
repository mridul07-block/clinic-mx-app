import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LiveRelay,
  reconnectDelaySeconds,
  scheduleLiveChecks,
  type RelaySocket,
  type RelayTicket,
} from './live-relay';

// FND-09 done when: updates under 2 s; 15 s polling fallback; "Updated n s ago" shown. One socket
// per tab, a fresh ticket for each connect, reconnecting 1, 2, 4 … 30 s apart; screens check at
// once on a signal for their centre, every connected-check seconds while connected and every
// refresh seconds while not. Generated ids only.

const one = '00000000-0000-4000-8000-000000000101';
const two = '00000000-0000-4000-8000-000000000102';

class FakeSocket implements RelaySocket {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

function relayWith(tickets: (() => Promise<RelayTicket | null>)[]) {
  const sockets: FakeSocket[] = [];
  const ticket = vi.fn(() => (tickets.shift() ?? (() => Promise.resolve(null)))());
  const relay = new LiveRelay({
    ticket,
    open: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    },
    now: () => Date.now(),
  });
  return { relay, sockets, ticket };
}

const ticket = (token: string) => () => Promise.resolve({ url: 'wss://relay.example.test', token });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the relay connection', () => {
  it('waits longer after each failure, at most 30 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelaySeconds)).toEqual([1, 2, 4, 8, 16, 30, 30]);
  });

  it('never connects where the relay is not set up', async () => {
    const { relay, sockets } = relayWith([() => Promise.resolve(null)]);
    relay.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toEqual([]);
    expect(relay.connected).toBe(false);
  });

  it('connects with its token, and passes on the centres that changed', async () => {
    const { relay, sockets } = relayWith([ticket('token-1')]);
    const states: boolean[] = [];
    const heard: (readonly string[])[] = [];
    relay.onState((connected) => states.push(connected));
    relay.onSignal((centres) => heard.push(centres));
    relay.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = sockets[0];
    expect(socket?.url).toBe('wss://relay.example.test/connect?token=token-1');
    socket?.onopen?.();
    expect(relay.connected).toBe(true);
    socket?.onmessage?.({ data: JSON.stringify({ centres: [one] }) });
    socket?.onmessage?.({ data: 'pong' });
    socket?.onmessage?.({ data: 'not json' });
    socket?.onmessage?.({ data: JSON.stringify({ centres: [] }) });
    expect(heard).toEqual([[one]]);
    expect(states).toEqual([true]);
  });

  it('reconnects with a fresh ticket, waiting longer each time, and resets once connected', async () => {
    const {
      relay,
      sockets,
      ticket: tickets,
    } = relayWith([
      ticket('a'),
      () => Promise.reject(new Error('offline')),
      ticket('b'),
      ticket('c'),
    ]);
    relay.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]?.onclose?.();
    expect(relay.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(tickets).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tickets).toHaveBeenCalledTimes(2);
    // The ticket failed: two seconds this time.
    await vi.advanceTimersByTimeAsync(1999);
    expect(tickets).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets[1]?.url).toContain('token=b');
    sockets[1]?.onopen?.();
    expect(relay.connected).toBe(true);
    sockets[1]?.onerror?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets[2]?.url).toContain('token=c');
  });

  it('pings, and treats a socket silent for a minute as gone', async () => {
    const { relay, sockets } = relayWith([ticket('a'), ticket('b')]);
    relay.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]?.onopen?.();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(sockets[0]?.sent).toEqual(['ping']);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(sockets[0]?.closed).toBe(true);
    expect(relay.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
  });

  it('stops for good', async () => {
    const { relay, sockets, ticket: tickets } = relayWith([ticket('a'), ticket('b')]);
    relay.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]?.onopen?.();
    relay.stop();
    expect(sockets[0]?.closed).toBe(true);
    expect(relay.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tickets).toHaveBeenCalledTimes(1);
  });
});

describe('a screen’s live checks', () => {
  async function connectedRelay() {
    const made = relayWith([ticket('a')]);
    made.relay.start();
    await vi.advanceTimersByTimeAsync(0);
    return made;
  }

  it('run every refresh seconds without a relay, as before', async () => {
    const check = vi.fn();
    const stop = scheduleLiveChecks(null, check, {
      refreshSeconds: 3,
      connectedSeconds: 15,
      centres: [one],
    });
    await vi.advanceTimersByTimeAsync(9000);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(9000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('slow to every 15 s while connected, and go back to 3 s when the relay drops', async () => {
    const { relay, sockets } = await connectedRelay();
    const check = vi.fn();
    scheduleLiveChecks(relay, check, { refreshSeconds: 3, connectedSeconds: 15, centres: [one] });
    sockets[0]?.onopen?.();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(check).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(1);
    sockets[0]?.onclose?.();
    await vi.advanceTimersByTimeAsync(3000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('check at once for a change at their centre, once for signals close together', async () => {
    const { relay, sockets } = await connectedRelay();
    sockets[0]?.onopen?.();
    const here = vi.fn();
    const anywhere = vi.fn();
    scheduleLiveChecks(relay, here, { refreshSeconds: 3, connectedSeconds: 15, centres: [one] });
    scheduleLiveChecks(relay, anywhere, {
      refreshSeconds: 3,
      connectedSeconds: 15,
      centres: 'any',
    });
    sockets[0]?.onmessage?.({ data: JSON.stringify({ centres: [two] }) });
    await vi.advanceTimersByTimeAsync(500);
    expect(here).not.toHaveBeenCalled();
    expect(anywhere).toHaveBeenCalledTimes(1);
    sockets[0]?.onmessage?.({ data: JSON.stringify({ centres: [one] }) });
    sockets[0]?.onmessage?.({ data: JSON.stringify({ centres: [one, two] }) });
    await vi.advanceTimersByTimeAsync(199);
    expect(here).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(here).toHaveBeenCalledTimes(1);
  });
});
