// Logique de tirage côté serveur (GitHub Action). Sans dépendance : la base est passée en paramètre,
// ce qui permet de la tester avec une fausse base. Mêmes règles que l'appli :
// le gagnant de la dernière ligne de l'historique est écarté (sauf s'il est seul inscrit).

async function loadConfig(db) {
  const snap = await db.collection("meta").doc("config").get();
  const d = snap.exists ? snap.data() : {};
  return {
    daysOff: Array.isArray(d.daysOff) ? d.daysOff : [],
    workedHolidays: Array.isArray(d.workedHolidays) ? d.workedHolidays : [],
  };
}

// Tire le gagnant si personne ne l'a fait (appli ouverte à 11h56, ou autre passage de la Action).
// Tout se passe dans une transaction : impossible d'obtenir deux gagnants, même en cas de course.
// Retourne le gagnant tiré, ou null si rien n'a été fait.
async function drawIfNeeded({ db, dayRef, histRef, statsRef, dateFr, serverTs, inc, random = Math.random }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    const histSnap = await tx.get(histRef);
    const data = snap.exists ? snap.data() : null;
    if (!data || data.winner) return null;
    const participants = data.participants || [];
    if (participants.length === 0) return null;

    const entries = histSnap.exists ? (histSnap.data().entries || []) : [];
    const lastWinner = entries[0] && entries[0].name;
    let pool = participants;
    if (lastWinner && participants.length > 1) {
      const filtered = participants.filter((p) => p.name !== lastWinner);
      if (filtered.length > 0) pool = filtered;
    }
    const chosen = pool[Math.floor(random() * pool.length)];
    const entry = { name: chosen.name, bag: chosen.bag, date: dateFr };

    tx.set(dayRef, { ...data, winner: chosen, drawnAt: serverTs });
    tx.set(histRef, { entries: [entry, ...entries].slice(0, 30) });
    // Même comptabilité que l'appli : sans cette ligne, un tirage fait par la Action ne serait jamais
    // compté dans les statistiques (le gagnant aurait une participation mais pas de victoire).
    if (statsRef && inc) tx.set(statsRef, { wins: { [chosen.name]: inc(1) } }, { merge: true });
    return chosen;
  });
}

// Réserve l'envoi de la notification (une seule exécution à la fois peut la "gagner").
// Retourne le gagnant à annoncer, ou null s'il n'y en a pas / si c'est déjà notifié.
async function claimNotification({ db, dayRef }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    const data = snap.exists ? snap.data() : null;
    if (!data || !data.winner || data.pushSent) return null;
    tx.update(dayRef, { pushSent: true });
    return data.winner;
  });
}

// Texte de la notification : mêmes mots que dans l'appli (« se porte volontaire » ou « a été désigné·e »).
function winnerMessage(winner) {
  const who = winner.volunteer ? `${winner.name} se porte volontaire 🙋` : `${winner.name} a été désigné·e`;
  return winner.bag ? `${who} — Sac n°${winner.bag}` : who;
}

// ---------------------------------------------------------------------------------------------
// Veille autour du tirage
//
// Les passages « toutes les 5 minutes » de GitHub ne sont pas ponctuels : GitHub les retarde (parfois de
// plusieurs dizaines de minutes) ou en saute quand il est chargé. La notification partait donc au prochain
// passage réellement démarré : d'où des délais aléatoires après le tirage.
// Solution : à partir de 11h00 (Paris), un passage ne s'arrête plus tout de suite : il reste « en veille »,
// regarde la base toutes les 10 secondes, et envoie la notification dès qu'un gagnant existe. À 11h57 il
// effectue lui-même le tirage de secours si personne ne l'a fait.
// ---------------------------------------------------------------------------------------------
const DRAW_FALLBACK_MIN = 11 * 60 + 57; // un cran après le tirage automatique de l'appli (11h56)
const WATCH_FROM_MIN = 11 * 60;         // la veille commence à 11h00 (heure de Paris)
const WATCH_UNTIL_MIN = 12 * 60 + 20;   // ... et s'arrête au plus tard à 12h20
const POLL_MS = 10 * 1000;

// Une vérification. États retournés :
//   "off"      jour sans tirage (week-end, férié...) : rien à faire
//   "waiting"  pas encore de gagnant (ou pas d'inscrit) : on peut réessayer
//   "already"  la notification du jour est déjà partie
//   "notified" la notification vient d'être envoyée par cette vérification
async function checkOnce({ db, Days, config, now = new Date(), getRefs, serverTs, inc, sendPush, random }) {
  const parts = Days.parisParts(now);
  const off = Days.dayOffReason(parts, config);
  if (off) return { state: "off", detail: off.label };

  const dayKey = Days.dateKey(parts);
  const minutes = parts.hour * 60 + parts.minute;
  const { dayRef, histRef, statsRef } = getRefs(dayKey);

  const snap = await dayRef.get();
  const data = snap.exists ? snap.data() : null;
  if (!data) return { state: "waiting", detail: "pas encore de document pour aujourd'hui" };
  if (data.winner && data.pushSent) return { state: "already" };
  if (!data.winner && minutes < DRAW_FALLBACK_MIN) return { state: "waiting", detail: "pas encore de gagnant" };

  let drawn = null;
  if (!data.winner) {
    drawn = await drawIfNeeded({ db, dayRef, histRef, statsRef, dateFr: Days.frDate(parts), serverTs, inc, random });
  }

  const winner = await claimNotification({ db, dayRef });
  if (!winner) {
    // Personne d'inscrit (donc pas de tirage possible), ou une autre exécution vient de notifier.
    const fresh = (await dayRef.get()).data();
    return fresh && fresh.winner && fresh.pushSent ? { state: "already" } : { state: "waiting", detail: "aucun inscrit" };
  }

  const result = await sendPush(winner, dayKey);
  if (result.sent === 0 && result.transient > 0) {
    // Panne générale (réseau, service push...) : on libère la réservation, la prochaine vérification réessaiera.
    await dayRef.update({ pushSent: false });
    return { state: "waiting", detail: "aucune notification partie, nouvelle tentative", result, drawn };
  }
  return { state: "notified", winner, result, drawn };
}

// La veille n'a lieu qu'entre 11h00 et 12h20 (Paris), et jamais pour un lancement manuel (oneShot).
function shouldWatch({ Days, now = new Date(), oneShot = false }) {
  if (oneShot) return false;
  const p = Days.parisParts(now);
  const minutes = p.hour * 60 + p.minute;
  return minutes >= WATCH_FROM_MIN && minutes < WATCH_UNTIL_MIN;
}

// Vérifie en boucle jusqu'à ce que la notification soit partie (ou inutile), ou jusqu'à 12h20.
async function watch({ check, Days, sleep, now = () => new Date(), log = () => {}, pollMs = POLL_MS }) {
  let polls = 0;
  for (;;) {
    const result = await check();
    if (result.state !== "waiting") return result;
    const p = Days.parisParts(now());
    if (p.hour * 60 + p.minute >= WATCH_UNTIL_MIN) return { state: "timeout" };
    polls += 1;
    if (polls % 30 === 1) log(`En veille (${String(p.hour).padStart(2, "0")}h${String(p.minute).padStart(2, "0")}) : ${result.detail || "en attente"}`);
    await sleep(pollMs);
  }
}

module.exports = {
  loadConfig, drawIfNeeded, claimNotification, winnerMessage,
  checkOnce, shouldWatch, watch,
  DRAW_FALLBACK_MIN, WATCH_FROM_MIN, WATCH_UNTIL_MIN, POLL_MS,
};
