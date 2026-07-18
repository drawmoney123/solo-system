const CACHE_PREFIX = 'solo-system-';
const CACHE_NAME = `${CACHE_PREFIX}v9`;
const SCOPE_URL = new URL(self.registration.scope);
const INDEX_URL = new URL('./index.html', SCOPE_URL).href;

const APP_SHELL_URLS = [
  new URL('./', SCOPE_URL).href,
  INDEX_URL,
  new URL('./manifest.webmanifest', SCOPE_URL).href,
  new URL('./icon-192.png', SCOPE_URL).href,
  new URL('./icon-512.png', SCOPE_URL).href,
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // addAll is atomic: a broken or missing app-shell file keeps the previous
    // worker active instead of installing a partially populated offline cache.
    const requests = APP_SHELL_URLS.map(url => new Request(url, { cache: 'reload' }));
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    const obsoleteAppCaches = cacheNames.filter(
      name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
    );

    await Promise.all(obsoleteAppCaches.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  const isSameOrigin = requestUrl.origin === SCOPE_URL.origin;
  const isInScope = requestUrl.pathname.startsWith(SCOPE_URL.pathname);
  if (!isSameOrigin || !isInScope) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, true));
    return;
  }

  // Cache-busted content.json requests must always reach the network and must
  // not create one cache entry per timestamp.
  if (requestUrl.search) return;

  event.respondWith(networkFirst(request, false));
});

async function networkFirst(request, useIndexFallback) {
  try {
    const response = await fetch(request);

    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      try {
        // Awaiting put keeps the fetch event alive until the write has settled.
        await cache.put(request, response.clone());
      } catch (error) {
        // A storage-quota failure must not hide an otherwise valid response.
        console.warn('Personal Plan: cache write failed', error);
      }
    }

    return response;
  } catch (networkError) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    if (useIndexFallback) {
      const indexResponse = await cache.match(INDEX_URL);
      if (indexResponse) return indexResponse;
    }

    throw networkError;
  }
}
