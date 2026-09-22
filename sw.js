// ============================================================
// Configuration du cache pour la PWA
// ============================================================
const CACHE_NAME = "tirage-repas-shell-v1";
const SHELL_FILES = ["./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

// ============================================================
// Notifications Web Push natives (indépendantes de Firebase Cloud
// Messaging — envoyées par la GitHub Action, pas de plan payant requis)
// ============================================================
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Tirage du jour 🥡", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Tirage du jour 🥡";
  const options = {
    body: data.body || "Un gagnant a été désigné !",
    icon: "icon-192.png",
    data: { url: data.url || "./" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "./"));
});

self.addEventListener("notificationclose", (event) => {
  console.log("[sw.js] Notification fermée :", event.notification);
});

// ============================================================
// Logique de cache (stratégie "réseau d'abord")
// ============================================================
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // On ne gère que les requêtes de la même origine (pas Firebase, CDN, etc.)
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
