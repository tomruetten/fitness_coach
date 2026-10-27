// Schätzt Schwellenpace und lockeres Tempo aus den Läufen der letzten Wochen.
// Das Ergebnis ist ein Vorschlag; übernommen wird er erst nach Bestätigung in den Einstellungen.
import { diffDays } from './dates.js';
import { zoneBounds } from './zones.js';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

export function estimateThreshold(activities, settings, asOf, weeks = 8) {
  const runs = activities.filter((a) => a.sport === 'running' && diffDays(asOf, a.local_date) <= weeks * 7 && diffDays(asOf, a.local_date) >= 0);
  // Nur Anstrengungen, die hart genug waren: mittlerer Puls mindestens 97 % des Schwellenpulses.
  const hard = runs
    .map((a) => a.best?.m30)
    .filter((b) => b && b.hr >= settings.lthr * 0.97);
  let ltPace = null;
  let ltHr = null;
  if (hard.length) {
    const b = hard.reduce((x, y) => (y.pace_s < x.pace_s ? y : x));
    ltPace = b.pace_s;
    ltHr = b.hr;
  }
  // Lockeres Tempo: Median der Kilometer, deren Puls in Z2 lag
  const [b2, b3] = zoneBounds(settings.lthr);
  const z2 = runs.flatMap((a) => (a.km_splits || []).filter((k) => k.hr >= b2 && k.hr < b3 && k.pace_s > 240 && k.pace_s < 480).map((k) => k.pace_s));
  const easy = z2.length >= 10 ? Math.round(median(z2)) : null;

  const suggestion = {};
  if (ltPace && Math.abs(ltPace - settings.lt_pace_s) >= 3) suggestion.lt_pace_s = ltPace;
  if (ltHr && Math.abs(ltHr - settings.lthr) >= 2) suggestion.lthr = ltHr;
  return { ltPace, ltHr, easyPace: easy, suggestion, basedOn: { hardEfforts: hard.length, z2Splits: z2.length } };
}
