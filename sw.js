/**
 * Flulivre — Service Worker (PWA)
 * Permet d'installer l'application sur Android/iOS/PC et de l'utiliser hors-ligne.
 *
 * Stratégies :
 *  - coquille applicative (HTML/CSS/JS/icône) : mise en cache à l'installation ;
 *  - navigations : réseau d'abord, repli sur le cache (ouvre hors-ligne) ;
 *  - autres requêtes même origine : cache d'abord ;
 *  - CDN (JSZip, pdf.js, Tesseract…) : réseau d'abord, mise en cache de secours.
 */

const CACHE = 'flulivre-v7';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'icons/icon-512.png',
  'js/app.js',
  'js/audio.js',
  'js/db.js',
  'js/importers.js',
  'js/library.js',
  'js/player.js',
  'js/sample.js',
  'js/text.js',
  'js/tts.js',
  'js/utils.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // allSettled : un fichier manquant ne doit pas empêcher l'installation
      Promise.allSettled(SHELL.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navigations : réseau d'abord, sinon index.html en cache (hors-ligne)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  // Même origine : cache immédiat + rafraîchissement en arrière-plan
  // (hors-ligne instantané ET nouvelles versions appliquées au rechargement suivant)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => null);
        return hit || net.then((r) => {
          if (r) return r;
          throw new Error('Hors-ligne : ' + req.url);
        });
      })
    );
    return;
  }

  // CDN : réseau d'abord, cache en secours (fonctionne hors-ligne après 1ʳᵉ visite)
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
