const CACHE = '4philly-v33';
const STATIC = ['./', './index.html', './404.html', './manifest.json', './icon.svg'];
// Both Google Fonts origins: the CSS from fonts.googleapis.com AND the font
// binaries from fonts.gstatic.com. Caching only the binaries left the fonts
// dead offline because the stylesheet that references them was never cached.
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const API_ORIGINS = ['https://services.arcgis.com', 'https://phl.carto.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Font CSS + files: cache-first
  if (FONT_ORIGINS.includes(url.origin)) {
    e.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return r;
      }))
    );
    return;
  }

  // API calls: network-only (data must be live)
  if (API_ORIGINS.some(o => url.href.startsWith(o))) {
    e.respondWith(
      fetch(request).catch(() => new Response('{"error":"offline"}', {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Same-origin (HTML, manifest, icon): network-first, stale fallback.
  // Only cache OK responses — a transient 404/500 must never overwrite a
  // good cached copy of index.html.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(request).then(r => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return r;
      }).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
    );
  }
});
