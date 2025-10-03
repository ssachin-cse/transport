const CACHE = 'transport-cache-v1';
const ASSETS = [
  './index.html',
  './assets/style.css',
  './assets/app.js',
  './manifest.webmanifest'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('fetch', e=>{
  e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
});
