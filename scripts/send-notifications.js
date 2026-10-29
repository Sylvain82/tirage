// Exécuté par la GitHub Action (voir .github/workflows/notify-winner.yml) :
//  1. ne fait rien les week-ends, jours fériés et jours sans tirage ;
//  2. entre 11h00 et 12h20 (Paris), reste « en veille » et envoie la notification dans les ~10 secondes
//     qui suivent le tirage (voir draw-logic.js pour l'explication) ;
//  3. filet de sécurité : si personne n'a tiré à 11h57, tire le gagnant à la place de l'appli ;
//  4. envoie la notification push, une seule fois par tirage.
// Lancé à la main (« Run workflow »), il ne fait qu'une seule vérification, sans veille.

const admin = require("firebase-admin");
const webpush = require("web-push");
const Days = require("../days.js");
const { loadConfig, checkOnce, shouldWatch, watch, winnerMessage, POLL_MS } = require("./draw-logic.js");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

webpush.setVapidDetails(
  "mailto:notifications@jva-tirage.local", // adresse de contact générique, exigée par le standard Web Push
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const getRefs = (dayKey) => ({
  dayRef: db.collection("draws").doc(dayKey),
  histRef: db.collection("meta").doc("history"),
  statsRef: db.collection("meta").doc("stats"),
});

// Envoie la notification à tous les appareils abonnés.
async function sendPush(winner, dayKey) {
  const payload = JSON.stringify({
    title: "Tirage du jour 🥡",
    body: winnerMessage(winner),
    url: "./",
    tag: "tirage-" + dayKey, // même étiquette que la notification locale de l'appli : la seconde remplace la première au lieu de s'ajouter
  });

  const subsSnap = await db.collection("pushSubscriptions").get();
  if (subsSnap.empty) {
    console.log("Aucun appareil abonné pour l'instant.");
    return { sent: 0, removed: 0, transient: 0, subscribers: 0 };
  }

  let sent = 0, removed = 0, transient = 0;
  await Promise.all(
    subsSnap.docs.map(async (docSnap) => {
      try {
        await webpush.sendNotification(docSnap.data(), payload, {
          urgency: "high", // livraison prioritaire, pour éviter le retard lié au mode veille d'Android
          TTL: 3600,       // valable 1 h si l'appareil est injoignable, puis abandonnée
        });
        sent += 1;
      } catch (err) {
        console.error("Échec d'envoi, statut :", err.statusCode, err.body || "");
        if (err.statusCode === 404 || err.statusCode === 410) {
          await docSnap.ref.delete(); // abonnement expiré ou désinstallé
          removed += 1;
        } else {
          transient += 1;
        }
      }
    })
  );
  console.log(`Notifications envoyées : ${sent}. Abonnements invalides supprimés : ${removed}. Échecs temporaires : ${transient}.`);
  return { sent, removed, transient, subscribers: subsSnap.size };
}

function report(result) {
  if (result.drawn) console.log(`Tirage de secours effectué par la Action : ${result.drawn.name} (sac n°${result.drawn.bag}).`);
  switch (result.state) {
    case "off": console.log(`Pas de tirage aujourd'hui (${result.detail}), rien à faire.`); break;
    case "already": console.log("Rien à notifier : la notification du jour est déjà partie."); break;
    case "notified": console.log(`Notification envoyée pour ${result.winner.name}.`); break;
    case "timeout": console.log("Fin de la veille (12h20) sans gagnant à annoncer."); break;
    default: console.log(`Rien à notifier pour l'instant (${result.detail || "en attente"}).`);
  }
}

async function main() {
  const config = await loadConfig(db);
  const check = () => checkOnce({
    db, Days, config, getRefs, sendPush,
    serverTs: admin.firestore.FieldValue.serverTimestamp(),
    inc: (n) => admin.firestore.FieldValue.increment(n),
  });

  const oneShot = process.env.ONESHOT === "1";
  const force = process.env.FORCE_WATCH === "1";
  if (!shouldWatch({ Days, oneShot, force })) {
    report(await check());
    return;
  }

  console.log("Mode veille : vérification toutes les 10 secondes jusqu'au tirage (12h20 au plus tard).");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  report(await watch({ check, Days, sleep, log: console.log, pollMs: POLL_MS }));
}

main().then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); }
);
