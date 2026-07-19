const CACHE = 'dot-memo-v8';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([
      './',
      './index.html',
      './style.css',
      './js/firebase.js',
      './src/app.js',
      './src/interactions.js',
      './src/api/router.js',
      './src/api/audio.js',
      './src/parsers/shopping.js',
      './src/parsers/games.js',
      './src/parsers/tasks.js',
      './src/parsers/notes.js',
      './manifest.json',
      './icon-192.png',
      './icon-512.png'
    ])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => {
        if (k !== CACHE) return caches.delete(k);
      })
    )).then(() => self.clients.claim())
  );
});

// Network-First Strategy to allow instant live updates
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(response => {
      if (response.status === 200) {
        const responseClone = response.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, responseClone));
      }
      return response;
    }).catch(() => caches.match(e.request))
  );
});
