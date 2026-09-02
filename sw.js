/* Offline is the product: after one visit, everything is served from this
   cache. Bump the version string whenever any file changes, or installed
   copies keep the old app forever. */
const CACHE = 'setlist-studio-v3';
const ASSETS = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'seed.js',
  'manifest.webmanifest',
  'vendor/sortable.min.js',
  'vendor/inter.css',
  'vendor/inter-latin.woff2',
  'vendor/jspdf.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((hit) => hit || fetch(event.request)),
  );
});
