importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyDipngZ7rA-TgyQQ-eB-1veggfbcmpHd2s",
  authDomain: "tirage-repas.firebaseapp.com",
  projectId: "tirage-repas",
  storageBucket: "tirage-repas.firebasestorage.app",
  messagingSenderId: "634341227314",
  appId: "1:634341227314:web:2d00ba1cbee9dbd46d752b",
  measurementId: "G-7HSTL97R21",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Message reçu :", payload);
  const notificationTitle = payload.notification?.title || "Tirage du jour 🥡";
  const notificationOptions = {
    body: payload.notification?.body || "Un gagnant a été désigné !",
    icon: "/icon-192.png",
    data: { url: payload.data?.url || "/" },
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});
