// ============================================================
// Configuration du cache pour la PWA
// ============================================================
const CACHE_NAME = "tirage-repas-shell-v1";
const SHELL_FILES = ["./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

// ============================================================
// 1. Importer Firebase pour les notifications push
// ============================================================
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

// Configuration Firebase (doit correspondre à ton projet)
const firebaseConfig = {
  apiKey: "AIzaSyDipngZ7rA-TgyQQ-eB-1veggfbcmpHd2s",
  authDomain: "tirage-repas.firebaseapp.com",
  projectId: "tirage-repas",
  storageBucket: "tirage-repas.firebasestorage.app",
  messagingSenderId: "634341227314",
  appId: "1:634341227314:web:2d00ba1cbee9dbd46d752b",
  measurementId: "G-7HSTL97R21",
};

// Initialiser Firebase Messaging
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ============================================================
// 2. Gestion des notifications push (FCM)
// ============================================================

// Écouter les messages en arrière-plan
messaging.onBackgroundMessage((payload) => {
  console.log("[sw.js] Message FCM reçu en arrière-plan :", payload);

  // Extraire les données de la notification
  const notificationTitle = payload.notification?.title || "Tirage du jour 🥡";
  const notificationOptions = {
    body: payload.notification?.body || "Un gagnant a été désigné !",
    icon: "/icon-192.png",
    data: {
      url: payload.data?.url || "/", // URL à ouvrir si l'utilisateur clique
    },
  };

  // Afficher la notification
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Écouter les clics sur les notifications
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || "/")
  );
});

// Écouter la fermeture des notifications
self.addEventListener("notificationclose", (event) => {
  console.log("[sw.js] Notification fermée :", event.notification);
});

// ============================================================
// 3. Logique de cache (inchangée)
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

// Stratégie "réseau d'abord" pour les fichiers de l'app
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
