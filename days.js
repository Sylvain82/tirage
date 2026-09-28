// Calendrier partagé par l'appli (navigateur) et par la GitHub Action (Node).
// Un seul endroit pour : l'heure de Paris, les jours fériés français, les jours sans tirage.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JVADays = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TZ = "Europe/Paris";
  const parisFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const pad = (n) => String(n).padStart(2, "0");

  // 0 = dimanche … 6 = samedi, pour une date calendaire (indépendant de tout fuseau)
  function weekdayOf(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  }

  // Date et heure "murales" à Paris, quel que soit le fuseau de l'appareil.
  function parisParts(date) {
    const p = {};
    for (const { type, value } of parisFmt.formatToParts(date)) p[type] = value;
    const year = +p.year, month = +p.month, day = +p.day;
    return { year, month, day, hour: +p.hour % 24, minute: +p.minute, weekday: weekdayOf(year, month, day) };
  }

  function dateKey(parts) { return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`; }
  function frDate(parts) { return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`; }

  function addDays(year, month, day, n) {
    const dt = new Date(Date.UTC(year, month - 1, day + n, 12));
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
  }

  // Dimanche de Pâques (algorithme de Meeus/Jones/Butcher)
  function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return { year, month, day };
  }

  const holidayCache = {};
  function holidaysOf(year) {
    if (holidayCache[year]) return holidayCache[year];
    const e = easterSunday(year);
    const map = {};
    const put = (d, name) => { map[`${d.year}-${pad(d.month)}-${pad(d.day)}`] = name; };
    const fromEaster = (n) => addDays(e.year, e.month, e.day, n);
    put({ year, month: 1, day: 1 }, "Jour de l'An");
    put(fromEaster(1), "Lundi de Pâques");
    put({ year, month: 5, day: 1 }, "Fête du Travail");
    put({ year, month: 5, day: 8 }, "Victoire 1945");
    put(fromEaster(39), "Ascension");
    put(fromEaster(50), "Lundi de Pentecôte");
    put({ year, month: 7, day: 14 }, "Fête nationale");
    put({ year, month: 8, day: 15 }, "Assomption");
    put({ year, month: 11, day: 1 }, "Toussaint");
    put({ year, month: 11, day: 11 }, "Armistice 1918");
    put({ year, month: 12, day: 25 }, "Noël");
    return (holidayCache[year] = map);
  }

  // Retourne null si c'est un jour de tirage, sinon { kind, label } :
  //   week-end | jour férié (calculé) | jour sans tirage ajouté à la main (config.daysOff).
  // config.workedHolidays : jours fériés travaillés dans l'entreprise (ex. lundi de Pentecôte).
  function dayOffReason(parts, config) {
    const cfg = config || {};
    const key = dateKey(parts);
    if (parts.weekday === 0 || parts.weekday === 6) return { kind: "weekend", label: "week-end" };
    if ((cfg.daysOff || []).includes(key)) return { kind: "custom", label: "jour sans tirage" };
    const name = holidaysOf(parts.year)[key];
    if (name && !(cfg.workedHolidays || []).includes(key)) return { kind: "holiday", label: name };
    return null;
  }

  function nextDrawDay(parts, config) {
    for (let n = 1; n <= 30; n++) {
      const d = addDays(parts.year, parts.month, parts.day, n);
      const p = { year: d.year, month: d.month, day: d.day, weekday: weekdayOf(d.year, d.month, d.day) };
      if (!dayOffReason(p, config)) return { n, date: p };
    }
    return null;
  }

  // "demain", "lundi", ou "lundi 5 octobre" si c'est plus loin qu'une semaine
  function nextDrawDayLabel(parts, config) {
    const next = nextDrawDay(parts, config);
    if (!next) return "bientôt";
    if (next.n === 1) return "demain";
    const wd = WEEKDAYS[next.date.weekday];
    return next.n <= 6 ? wd : `${wd} ${next.date.day} ${MONTHS[next.date.month - 1]}`;
  }

  return { TZ, parisParts, dateKey, frDate, easterSunday, holidaysOf, dayOffReason, nextDrawDayLabel };
});
