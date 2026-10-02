const CACHE_NAME = 'period-tracker-shell-v11';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './calendar-model.mjs',
  './manifest.webmanifest',
  './assets/logo.png',
  './assets/logo@3x.png',
  './assets/app-icon-192.png',
  './assets/app-icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('period-tracker-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// 通信できるときは再検証し、オフライン時だけ保存済みのファイルを使う。
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const cacheKey = request.mode === 'navigate'
    ? new URL('./index.html', self.registration.scope)
    : new URL(request.url);
  cacheKey.search = '';

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    let response;
    try {
      response = await fetch(new Request(request, { cache: 'no-cache' }));
    } catch (error) {
      const cached = await cache.match(cacheKey.href);
      if (cached) return cached;
      throw error;
    }

    if (response.ok) {
      // 保存に失敗しても、取得できた最新版は表示する。
      try {
        await cache.put(cacheKey.href, response.clone());
      } catch {}
      return response;
    }
    return (await cache.match(cacheKey.href)) || response;
  })());
});
