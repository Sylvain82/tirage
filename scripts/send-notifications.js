// Exécuté par la GitHub Action (voir .github/workflows/notify-winner.yml) :
//  1. ne fait rien les week-ends, jours fériés et jours sans tirage ;
//  2. filet de sécurité : si personne n'a tiré à 11h57, tire le gagnant à la place de l'appli ;
//  3. envoie la notification push, une seule fois par tirage.

const admin = require("firebase-admin");
const webpush = require("web-push");
const Days = require("../days.js");
const { loadConfig, drawIfNeeded, claimNotification, winnerMessage } = require("./draw-logic.js");

const DRAW_FALLBACK_MIN = 11 * 60 + 57; // un cran après le tirage automatique de l'appli (11h56)

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

webpush.setVapidDetails(
  "mailto:notifications@jva-tirage.local", // adresse de contact générique, exigée par le standard Web Push
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function main() {
  const parts = Days.parisParts(new Date());
  const config = await loadConfig(db);

  const off = Days.dayOffReason(parts, config);
  if (off) {
    console.log(`Pas de tirage aujourd'hui (${off.label}), rien à faire.`);
    return;
  }

  const dayRef = db.collection("draws").doc(Days.dateKey(parts));
  const histRef = db.collection("meta").doc("history");

  const snap = await dayRef.get();
  if (!snap.exists) {
    console.log("Aucun document pour aujourd'hui, rien à faire.");
    return;
  }

  if (parts.hour * 60 + parts.minute >= DRAW_FALLBACK_MIN) {
    const drawn = await drawIfNeeded({
      db, dayRef, histRef,
      dateFr: Days.frDate(parts),
      serverTs: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (drawn) console.log(`Tirage de secours effectué par la Action : ${drawn.name} (sac n°${drawn.bag}).`);
  }

  const winner = await claimNotification({ db, dayRef });
  if (!winner) {
    console.log("Rien à notifier (pas encore de gagnant, ou notification déjà envoyée).");
    return;
  }

  const payload = JSON.stringify({
    title: "Tirage du jour 🥡",
    body: winnerMessage(winner),
    url: "./",
  });

  const subsSnap = await db.collection("pushSubscriptions").get();
  if (subsSnap.empty) {
    console.log("Aucun appareil abonné pour l'instant.");
    return;
  }

  let sent = 0, removed = 0, transientFailures = 0;
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
          transientFailures += 1;
        }
      }
    })
  );
  console.log(`Notifications envoyées : ${sent}. Abonnements invalides supprimés : ${removed}. Échecs temporaires : ${transientFailures}.`);

  // Panne générale (réseau, service push…) : on libère la réservation pour réessayer au prochain passage.
  if (sent === 0 && transientFailures > 0) {
    await dayRef.update({ pushSent: false });
    console.log("Aucune notification partie : nouvelle tentative au prochain passage.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
