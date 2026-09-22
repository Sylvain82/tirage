// Envoie une notification Web Push à tous les appareils abonnés,
// une seule fois par tirage, dès qu'un gagnant est détecté dans Firestore.
// Exécuté par la GitHub Action toutes les 5 minutes (voir le workflow).

const admin = require("firebase-admin");
const webpush = require("web-push");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

webpush.setVapidDetails(
  "mailto:notifications@jva-tirage.local", // adresse de contact générique, exigée par le standard Web Push
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function todayStr() {
  // Aligné sur le fuseau utilisé par l'appli (heure de Paris)
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function main() {
  const dayId = todayStr();
  const dayRef = db.collection("draws").doc(dayId);
  const snap = await dayRef.get();

  if (!snap.exists) {
    console.log(`Aucun document pour ${dayId}, rien à faire.`);
    return;
  }

  const data = snap.data();

  if (!data.winner) {
    console.log("Pas encore de gagnant aujourd'hui.");
    return;
  }

  if (data.pushSent) {
    console.log("Notification déjà envoyée pour ce tirage.");
    return;
  }

  const payload = JSON.stringify({
    title: "Tirage du jour 🥡",
    body: `${data.winner.name} a été désigné·e — Sac n°${data.winner.bag}`,
    url: "./",
  });

  const subsSnap = await db.collection("pushSubscriptions").get();

  if (subsSnap.empty) {
    console.log("Aucun appareil abonné pour l'instant.");
  } else {
    let sent = 0;
    let removed = 0;
    await Promise.all(
      subsSnap.docs.map(async (docSnap) => {
        const subscription = docSnap.data();
        try {
          await webpush.sendNotification(subscription, payload);
          sent += 1;
        } catch (err) {
          console.error("Échec d'envoi, statut :", err.statusCode, err.body || "");
          if (err.statusCode === 404 || err.statusCode === 410) {
            await docSnap.ref.delete();
            removed += 1;
          }
        }
      })
    );
    console.log(`Notifications envoyées : ${sent}. Abonnements invalides supprimés : ${removed}.`);
  }

  await dayRef.update({ pushSent: true });
  console.log("Terminé.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
