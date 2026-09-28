/* ==========================================================================
   Service worker.

   Two jobs: make the site open instantly and survive a bad signal, and
   deliver push notifications so the owner hears about a booking without
   watching a screen.

   The caching rule is chosen around one fact: this site's content changes
   from the admin panel, not from a deploy. So:

     shell  (HTML, CSS, JS, icons) — serve from cache, refresh in the
                                     background, use the new copy next time
     data   (content/*.json)       — always try the network first; a stale
                                     price is worse than a slow page
     api    (/api, /admin, /receipts) — never cached, never touched

   Anything not GET is left alone entirely. A booking must never be answered
   from a cache.
   ========================================================================== */

// Bumping this name is what retires the old caches. It is the one thing to
// change when a release must not be served from an old copy.
const VERSION = 'cdm-v1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

// Enough to open the site with no signal at all.
const PRECACHE = [
  '/',
  '/style.css',
  '/content.js',
  '/script.js',
  '/livechat.js',
  '/manifest.webmanifest',
  '/images/logo.png',
  '/images/logo-mark.png',
  '/images/icon-192.png',
  '/offline',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll fails the whole install if any one file 404s, which would
    // leave the site with no worker at all. Each is added on its own.
    await Promise.all(PRECACHE.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n !== SHELL && n !== RUNTIME)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/** Never cached: anything that is about one person, or that writes. */
function isLive(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/admin')
    || url.pathname.startsWith('/receipts/');
}

/** Content the admin edits. A stale price or a retired package is worse
 *  than a page that takes a moment, so the network is asked first. */
function isData(url) {
  return url.pathname.startsWith('/content/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isLive(url)) return;

  if (isData(url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(RUNTIME);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (e) {
        // Offline: last known content is better than nothing at all.
        const cached = await caches.match(request);
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // Everything else: answer from cache at once, and quietly fetch a fresh
  // copy for next time.
  event.respondWith((async () => {
    const cached = await caches.match(request);

    const network = fetch(request).then(async (response) => {
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(SHELL);
        cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }

    const fresh = await network;
    if (fresh) return fresh;

    // No cache, no network. A page gets the offline notice; anything else
    // simply fails, which is what the page's own error handling expects.
    if (request.mode === 'navigate') {
      const offline = await caches.match('/offline');
      if (offline) return offline;
    }
    return Response.error();
  })());
});

// ---------------------------------------------------------------- push

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: "Cox's Dream Moment", body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || "Cox's Dream Moment";
  const options = {
    body: payload.body || '',
    icon: '/images/icon-192.png',
    badge: '/images/icon-192-maskable.png',
    // Same tag means a second notification replaces the first rather than
    // stacking; a phone with nine identical alerts gets silenced.
    tag: payload.tag || 'cdm',
    renotify: true,
    data: { url: payload.url || '/' },
    vibrate: [90, 50, 90],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If the site is already open, go to it rather than opening a second
    // window on top of the first.
    for (const client of all) {
      if (client.url.includes(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// Lets a page ask for the newest worker without a reload.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
