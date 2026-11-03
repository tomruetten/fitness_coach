import { zoneSeconds } from './zones.js';

// Belastungsmaß: Edwards-TRIMP mit Zonen-Gewichten 1..5 je Minute. Es braucht weder
// Geschlecht noch Ruhepuls und ist damit robust. Krafttraining wird über die Dauer
// geschätzt, weil der Puls dort die Beinbelastung kaum abbildet.
const ZONE_WEIGHT = [1, 2, 3, 4, 5];
export const STRENGTH_LOAD_PER_MIN = 1.5;

export function edwardsLoad(zoneSecs) {
  return zoneSecs.reduce((a, s, i) => a + (s / 60) * ZONE_WEIGHT[i], 0);
}

export function activityLoad({ sport, durationS, zoneSecs }) {
  if (sport === 'strength') return (durationS / 60) * STRENGTH_LOAD_PER_MIN;
  return edwardsLoad(zoneSecs || [0, 0, 0, 0, 0]);
}

export function samplesZoneLoad(samples, lthr) {
  return edwardsLoad(zoneSeconds(samples, lthr));
}

const DAY = 86400000;
const toDay = (d) => Math.floor(new Date(d).getTime() / DAY);

/**
 * Akute (7 Tage) gegen chronische Last (Wochenmittel der letzten 28 Tage), Stichtag eingeschlossen.
 * Gibt null zurück, wenn zu wenig Historie da ist (weniger als 14 Tage seit erster Aktivität).
 */
export function acuteChronic(activities, asOf) {
  const end = toDay(asOf);
  const first = activities.length ? Math.min(...activities.map((a) => toDay(a.start_time))) : end;
  const sum = (from, to) =>
    activities.reduce((acc, a) => {
      const d = toDay(a.start_time);
      return d >= from && d <= to ? acc + (a.load || 0) : acc;
    }, 0);
  const acute = sum(end - 6, end);
  const chronicWeekly = sum(end - 27, end) / 4;
  if (end - first < 14) return { acute, chronicWeekly, ratio: null };
  return { acute, chronicWeekly, ratio: chronicWeekly > 0 ? acute / chronicWeekly : null };
}

/**
 * Belastungsmodell mit exponentiell gewichteten Mittelwerten (Williams et al. 2017): akut = 7 Tage, chronisch = 28 Tage.
 * Gewichtet jüngere Tage stärker als das starre 7/28-Tage-Verhältnis und springt nicht, wenn ein Tag aus dem Fenster fällt.
 * `ratio` ist null, solange weniger als 14 Tage Historie vorliegen. Monotonie und Belastung nach Foster (1998).
 */
export function loadModel(activities, asOf) {
  const end = toDay(asOf);
  const acts = activities.filter((a) => toDay(a.start_time) <= end);
  if (!acts.length) return { acute: 0, chronic: 0, ratio: null, form: null, monotony: null, strain: null };
  const first = Math.min(...acts.map((a) => toDay(a.start_time)));
  const daily = new Map();
  for (const a of acts) daily.set(toDay(a.start_time), (daily.get(toDay(a.start_time)) || 0) + (a.load || 0));
  const la = 2 / (7 + 1), lc = 2 / (28 + 1);
  let acute = daily.get(first) || 0, chronic = acute;
  for (let d = first + 1; d <= end; d++) {
    const x = daily.get(d) || 0;
    acute = la * x + (1 - la) * acute;
    chronic = lc * x + (1 - lc) * chronic;
  }
  const week = [];
  for (let d = end - 6; d <= end; d++) week.push(daily.get(d) || 0);
  const m = week.reduce((a, b) => a + b, 0) / 7;
  const sd = Math.sqrt(week.reduce((a, b) => a + (b - m) ** 2, 0) / 6);
  const monotony = sd > 0 ? m / sd : null;
  return {
    acute, chronic,
    ratio: end - first >= 14 && chronic > 0 ? acute / chronic : null,
    form: chronic > 0 ? (chronic - acute) / chronic : null,   // positiv = frisch, negativ = müde
    monotony: monotony != null ? Math.round(monotony * 100) / 100 : null,
    strain: monotony != null ? Math.round(m * 7 * monotony) : null,
  };
}
