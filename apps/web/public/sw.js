// Clinic Mx service worker (FND-07): caches the staff app shell so it loads offline.
//
// It controls /app only (registered with that scope) and caches only:
// - the shell pages below, refreshed from the network on every online visit, and
// - the build's static files (/_next/static: scripts, styles, fonts), which never change
//   under the same URL.
// API responses and every other page pass straight through and are never stored, so no
// patient data is kept in the cache (rule 12). Offline drafts are FND-08's job.
//
// Each deployment registers /sw.js?v=<commit>; a new version installs a fresh shell and
// deletes the old caches.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL_CACHE = `clinic-mx-shell-${VERSION}`;
const STATIC_CACHE = `clinic-mx-static-${VERSION}`;
const SHELL_PAGES = ['/app', '/app/offline'];
const OFFLINE_PAGE = '/app/offline';

/** A response safe to keep: same origin, complete, not a redirect. */
function cacheable(response) {
  return response.ok && response.type === 'basic' && !response.redirected;
}

/** Static file URLs a shell page refers to (scripts, styles, preloaded fonts). */
function staticUrls(html) {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [])];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      const assets = new Set();
      for (const page of SHELL_PAGES) {
        const response = await fetch(page, { cache: 'no-store' });
        if (!cacheable(response)) throw new Error(`Shell page ${page} is not cacheable`);
        for (const url of staticUrls(await response.clone().text())) assets.add(url);
        await shell.put(page, response);
      }
      const statics = await caches.open(STATIC_CACHE);
      await statics.addAll([...assets]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith('clinic-mx-') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Static files: from the cache, else the network (and keep a copy). */
async function staticFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    const statics = await caches.open(STATIC_CACHE);
    await statics.put(request, response.clone());
  }
  return response;
}

/** Pages: the network first; offline, the cached shell page or the offline page. */
async function pageNetworkFirst(request, path) {
  const isShell = SHELL_PAGES.includes(path);
  try {
    const response = await fetch(request);
    if (isShell && cacheable(response)) {
      const shell = await caches.open(SHELL_CACHE);
      await shell.put(path, response.clone());
    }
    return response;
  } catch (error) {
    const shell = await caches.open(SHELL_CACHE);
    const fallback = (isShell && (await shell.match(path))) || (await shell.match(OFFLINE_PAGE));
    if (fallback) return fallback;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(staticFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(pageNetworkFirst(request, url.pathname.replace(/\/$/, '') || '/'));
  }
});
