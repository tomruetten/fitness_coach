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
