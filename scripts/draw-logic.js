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
async function drawIfNeeded({ db, dayRef, histRef, dateFr, serverTs, random = Math.random }) {
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

module.exports = { loadConfig, drawIfNeeded, claimNotification };
