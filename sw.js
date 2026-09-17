const CACHE_NAME = "tirage-repas-shell-v1";
const SHELL_FILES = ["./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stratégie "réseau d'abord" : à chaque ouverture avec internet, on récupère
// la version la plus fraîche sur GitHub Pages et on met le cache à jour.
// Le cache ne sert que de filet de sécurité si le réseau est indisponible.
// Ainsi, toute mise à jour poussée sur GitHub est automatiquement récupérée
// par tous les téléphones, sans réinstallation ni action de leur part.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // On ne gère que la coquille de l'appli (même origine).
  // Les appels Firebase / CDN / Google Fonts passent toujours directement
  // par le réseau, sans interception, pour rester en temps réel.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
