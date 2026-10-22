/* Offline is the product: after one visit, everything is served from this
   cache. Bump the version string whenever any file changes, or installed
   copies keep the old app forever. */
const CACHE = 'setlist-studio-v17';
const ASSETS = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'seed.js',
  'template.js',
  'manifest.webmanifest',
  'vendor/sortable.min.js',
  'vendor/lz-string.min.js',
  'vendor/google-sans.css',
  'vendor/google-sans-latin.woff2',
  'brand/sugar-whiskey.png',
  'vendor/jspdf.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// Each file is fetched fresh from the server. GitHub Pages lets browsers
// keep files for 10 minutes, so a plain fetch straight after publishing
// could fill the new cache with the old files and strand the update.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(
      ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
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
