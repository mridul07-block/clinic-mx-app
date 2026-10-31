import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { signLiveToken } from '../src/token';

// FND-09 done when: updates under 2 s. The relay runs locally (wrangler, no Cloudflare account):
// it takes a socket only for a token the app signed, from the app's origin; it takes a signal only
// with the database's secret; a signal reaches only the sockets of the centres it names, telling
// each only its own centres. Generated ids only.
const tokenSecret = 't'.repeat(40);
const signalSecret = 's'.repeat(40);
const origin = 'https://app.example.test';
const staffId = '00000000-0000-4000-8000-0000000000a1';

let worker: Unstable_DevWorker;
const open: WebSocket[] = [];

beforeAll(async () => {
  // From the test's own folder, whichever folder the tests are run from.
  const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  worker = await unstable_dev(here('../src/index.ts'), {
    config: here('../wrangler.toml'),
    vars: { TOKEN_SECRET: tokenSecret, SIGNAL_SECRET: signalSecret, ALLOWED_ORIGINS: origin },
    local: true,
    persist: false,
    logLevel: 'none',
    experimental: { disableExperimentalWarning: true },
  });
});
afterEach(() => {
  for (const socket of open.splice(0)) socket.close();
});
afterAll(async () => {
  await worker.stop();
});

const base = () => ['http://', worker.address, ':', String(worker.port)].join('');
const token = (centres: string[], expiresAt = Date.now() + 60_000, secret = tokenSecret) =>
  signLiveToken({ staffId, centres, expiresAt }, secret);

interface Screen {
  socket: WebSocket;
  heard: unknown[];
}

async function connect(centres: string[]): Promise<Screen> {
  const url = new URL('/connect', base().replace('http', 'ws'));
  url.searchParams.set('token', await token(centres));
  const socket = new WebSocket(url, { headers: { Origin: origin } } as never);
  open.push(socket);
  const heard: unknown[] = [];
  socket.addEventListener('message', (event) => {
    heard.push(event.data === 'pong' ? 'pong' : JSON.parse(String(event.data)));
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    });
    socket.addEventListener('error', () => {
      reject(new Error('The relay refused the socket.'));
    });
  });
  return { socket, heard };
}

/** The status a connect attempt gets: 101 when the relay takes the socket. */
function attempt(query: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const sent = request({
      host: worker.address,
      port: worker.port,
      path: ['/connect', query].join(''),
      headers: {
        Connection: 'Upgrade',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': btoa('0123456789abcdef'),
        ...headers,
      },
    });
    sent.on('upgrade', (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    sent.on('response', (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    sent.on('error', reject);
    sent.end();
  });
}

const signal = (body: unknown, secret = signalSecret) =>
  worker.fetch('/signal', {
    method: 'POST',
    headers: { Authorization: ['Bearer', secret].join(' '), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 300);
  });

describe('the live relay', () => {
  it('says it is up', async () => {
    const response = await worker.fetch('/health');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('takes a socket only for a live token the app signed, from the app’s origin', async () => {
    const good = encodeURIComponent(await token([crypto.randomUUID()]));
    const upgrade = { Upgrade: 'websocket', Origin: origin };
    expect(await attempt(['?token=', good].join(''), upgrade)).toBe(101);
    expect(await attempt(['?token=', good].join(''), { Origin: origin, Connection: 'close' })).toBe(
      426,
    );
    expect(
      await attempt(['?token=', good].join(''), { ...upgrade, Origin: 'https://evil.test' }),
    ).toBe(403);
    expect(await attempt(['?token=', good].join(''), { Upgrade: 'websocket' })).toBe(403);
    expect(await attempt('?token=nonsense', upgrade)).toBe(401);
    const expired = encodeURIComponent(await token([crypto.randomUUID()], Date.now() - 1));
    expect(await attempt(['?token=', expired].join(''), upgrade)).toBe(401);
    const forged = encodeURIComponent(
      await token([crypto.randomUUID()], Date.now() + 60_000, 'f'.repeat(40)),
    );
    expect(await attempt(['?token=', forged].join(''), upgrade)).toBe(401);
  });

  it('takes a signal only with the database’s secret, and only a signal', async () => {
    expect((await signal({ centres: [], all: true }, 'w'.repeat(40))).status).toBe(401);
    const unsigned = await worker.fetch('/signal', {
      method: 'POST',
      body: JSON.stringify({ centres: [], all: true }),
    });
    expect(unsigned.status).toBe(401);
    for (const bad of [null, {}, { centres: ['HSR'], all: false }, { centres: [], all: 'yes' }]) {
      expect((await signal(bad)).status).toBe(400);
    }
  });

  it('pings only the screens of the centres that changed, each with its own centres', async () => {
    const [one, two, other] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const onlyOne = await connect([one]);
    const onlyTwo = await connect([two]);
    const both = await connect([one, two]);
    const response = await signal({ centres: [one, other], all: false });
    expect(await response.json()).toEqual({ sent: 2 });
    await settle();
    expect(onlyOne.heard).toEqual([{ centres: [one] }]);
    expect(both.heard).toEqual([{ centres: [one] }]);
    expect(onlyTwo.heard).toEqual([]);
  });

  it('pings every screen for a change everywhere, each with its own centres', async () => {
    const [one, two] = [crypto.randomUUID(), crypto.randomUUID()];
    const first = await connect([one]);
    const second = await connect([one, two]);
    await signal({ centres: [], all: true });
    await settle();
    expect(first.heard).toEqual([{ centres: [one] }]);
    expect(second.heard).toEqual([{ centres: [one, two] }]);
  });

  it('answers a ping, so a screen knows its socket is alive', async () => {
    const screen = await connect([crypto.randomUUID()]);
    screen.socket.send('ping');
    await settle();
    expect(screen.heard).toEqual(['pong']);
  });
});
