// Krank-Modus: Zeiträume mit Krankheit sind keine versäumten Tage, und nach der Krankheit steigt die Belastung in Stufen.
//
// Daten (Einstellung `illness`): { episodes: [{ start, end|null, severity }], log: { 'YYYY-MM-DD': 'besser'|'gleich'|'schlechter' } }
//   `end` ist der letzte kranke Tag. Ohne `end` ist die Krankheit offen: kranke Tage reichen bis heute.
//
// Wiedereinstieg: Richtwerte aus der Praxis, keine harte Wissenschaft. Je länger die Pause und je schwerer die Krankheit,
// desto länger nur lockere Läufe, desto länger keine Qualität und desto niedriger der Wochenumfang am Anfang.
// Nackenregel: Beschwerden nur oberhalb des Halses erlauben leichtes Training, bei Fieber, Husten in der Brust oder
// Gliederschmerzen ruht der Sport.
import { addDays, diffDays, mondayOf } from './dates.js';

export const SEVERITIES = ['leicht', 'mittel', 'schwer'];
export const SEVERITY_LABEL = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer' };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round5 = (x) => Math.round(x * 2) / 2;

export const episodesOf = (settings) => settings?._illness?.episodes || [];
export const logOf = (settings) => settings?._illness?.log || {};

/** Episode, in der `date` ein kranker Tag ist. Offene Episoden gelten nur bis `today`. */
export function sickEpisode(settings, date, today = date) {
  return episodesOf(settings).find((e) => e.start <= date && (e.end ? e.end >= date : date <= today)) || null;
}
export const isSick = (settings, date, today = date) => !!sickEpisode(settings, date, today);

/**
 * Richtwerte für den Wiedereinstieg nach `pause` Tagen und Schweregrad.
 * easyDays: nur lockere Läufe (kein langer Lauf, keine Qualität, Spinning locker)
 * noQuality: so viele Tage nach der Krankheit keine Qualitätseinheit
 * vol0: Wochenumfang am ersten Tag als Anteil des Normalumfangs, steigt über `ramp` Tage linear auf 100 %
 * weightScale: Kraftgewichte in dieser Zeit
 */
export function returnPlan(pause, severity) {
  const si = Math.max(0, SEVERITIES.indexOf(severity));
  const T = {
    kurz: [ // 1–3 Tage
      { easyDays: 1, noQuality: 2, vol0: 1, ramp: 2, weightScale: 1 },
      { easyDays: 2, noQuality: 3, vol0: 1, ramp: 3, weightScale: 1 },
      { easyDays: 3, noQuality: 4, vol0: 0.85, ramp: 5, weightScale: 0.9 },
    ],
    woche: [ // 4–7 Tage
      { easyDays: 3, noQuality: 4, vol0: 0.7, ramp: 7, weightScale: 0.92 },
      { easyDays: 4, noQuality: 6, vol0: 0.6, ramp: 10, weightScale: 0.9 },
      { easyDays: 5, noQuality: 8, vol0: 0.5, ramp: 14, weightScale: 0.88, doctor: true },
    ],
    zwei: [ // 8–14 Tage
      { easyDays: 4, noQuality: 7, vol0: 0.6, ramp: 14, weightScale: 0.9 },
      { easyDays: 5, noQuality: 10, vol0: 0.5, ramp: 17, weightScale: 0.88 },
      { easyDays: 6, noQuality: 14, vol0: 0.5, ramp: 21, weightScale: 0.85, doctor: true },
    ],
    lang: [ // über 14 Tage: wie ein neuer Block
      { easyDays: 7, noQuality: 14, vol0: 0.5, ramp: 21, weightScale: 0.85 },
      { easyDays: 7, noQuality: 14, vol0: 0.5, ramp: 21, weightScale: 0.85 },
      { easyDays: 7, noQuality: 14, vol0: 0.5, ramp: 21, weightScale: 0.85, doctor: true },
    ],
  };
  const band = pause <= 3 ? 'kurz' : pause <= 7 ? 'woche' : pause <= 14 ? 'zwei' : 'lang';
  return { band, doctor: false, ...T[band][si] };
}

/** Anteil des Normalumfangs am Tag `since` (1 = erster Tag nach der Krankheit). */
export const volumeFactor = (rp, since) => (rp.vol0 >= 1 ? 1 : clamp(rp.vol0 + ((1 - rp.vol0) * (since - 1)) / Math.max(1, rp.ramp - 1), rp.vol0, 1));

/**
 * Zustand an einem Tag: krank, im Wiedereinstieg oder gesund.
 * @returns {{sick:boolean, ep?:object, day?:number, severity?:string, recovery:null|object, last?:object}}
 */
export function illnessState(settings, date, today = date) {
  const ep = sickEpisode(settings, date, today);
  if (ep) return { sick: true, ep, day: diffDays(date, ep.start) + 1, severity: ep.severity, open: !ep.end, recovery: null };
  const prev = episodesOf(settings).filter((e) => e.end && e.end < date).sort((a, b) => a.end.localeCompare(b.end)).pop();
  if (!prev) return { sick: false, recovery: null };
  const pause = diffDays(prev.end, prev.start) + 1;
  const rp = returnPlan(pause, prev.severity);
  const since = diffDays(date, prev.end);
  if (since > rp.ramp) return { sick: false, recovery: null, last: prev };
  const f = volumeFactor(rp, since);
  return {
    sick: false, last: prev,
    recovery: { since, pause, severity: prev.severity, ...rp, noQualityDays: rp.noQuality, factor: f, easy: since <= rp.easyDays, noQuality: since <= rp.noQuality, until: addDays(prev.end, rp.ramp), end: prev.end },
  };
}

/** Tage mit offenem Zustand: Gesamtbelastungs-Kennzahlen (Belastungsverhältnis) sind in dieser Zeit nicht aussagekräftig. */
export function illnessHold(settings, date, today = date) {
  const st = illnessState(settings, date, today);
  if (st.sick || st.recovery) return true;
  return !!st.last && diffDays(date, st.last.end) <= 28;
}

/** Montage der Wochen, in denen mindestens zwei Tage krank waren (für die Umfangsplanung neutral). */
export function sickWeeks(settings, before, today = before) {
  const count = {};
  for (const e of episodesOf(settings)) {
    const last = e.end || today;
    for (let d = e.start; d <= last && d < before; d = addDays(d, 1)) { const m = mondayOf(d); count[m] = (count[m] || 0) + 1; }
  }
  return new Set(Object.entries(count).filter(([, n]) => n >= 2).map(([m]) => m));
}

/** Zahl der Krankheitstage je Woche (Montag) in einem Zeitraum. */
export function sickDaysIn(settings, from, to, today = to) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isSick(settings, d, today)) n++;
  return n;
}

/**
 * Verlorene Trainingswochen in den letzten 8 Wochen: Krankheitstage plus der Umfang, der im Wiedereinstieg fehlt.
 * Wird im Rennmodus genutzt, um die aktuelle Phase zu verlängern.
 */
export function lostWeeks(settings, date, today = date) {
  const from = addDays(date, -56);
  let lost = 0;
  for (const e of episodesOf(settings)) {
    const cap = e.end || today;
    const last = cap < date ? cap : date;
    const s = e.start < from ? from : e.start;
    if (s <= last) lost += diffDays(last, s) + 1;
    if (e.end && e.end < date) {
      const rp = returnPlan(diffDays(e.end, e.start) + 1, e.severity);
      const upto = Math.min(rp.ramp, diffDays(date, e.end));
      for (let t = 1; t <= upto; t++) lost += 1 - volumeFactor(rp, t);
    }
  }
  return Math.min(4, Math.round((lost / 7) * 10) / 10);
}

/** Wochenumfang im Wiedereinstieg begrenzen: Referenz sind die Wochen vor der Krankheit. */
export function capWeek(wp, st, refKm) {
  if (!st.recovery || !refKm) return wp;
  const r = st.recovery;
  const cap = Math.max(8, round5(refKm * r.factor));
  if (wp.target <= cap && r.factor >= 1) return wp;
  const target = Math.min(wp.target, cap);
  return { ...wp, target, deload: false, c: 1, reason: `Wiedereinstieg nach ${r.pause} Tagen Pause (${SEVERITY_LABEL[r.severity].toLowerCase()}): Umfang auf ${Math.round(r.factor * 100)} % von ${refKm.toFixed(0)} km begrenzt (${target} km), steigt täglich weiter` };
}

/** Tageseinstufung für die Oberfläche. */
export function illnessView(settings, today) {
  const st = illnessState(settings, today, today);
  const log = logOf(settings);
  const episodes = episodesOf(settings);
  const recent = episodes.slice(-3).reverse().map((e) => ({ start: e.start, end: e.end || null, severity: e.severity, days: diffDays(e.end || today, e.start) + 1 }));
  const base = { sick: st.sick, today_log: log[today] || null, recent };
  if (st.sick) {
    const days = Object.keys(log).filter((d) => d >= st.ep.start && d <= today).sort();
    return { ...base, severity: st.severity, start: st.ep.start, day: st.day, trend: days.length ? log[days[days.length - 1]] : null };
  }
  if (st.recovery) {
    const r = st.recovery;
    return { ...base, recovery: { since: r.since, ramp: r.ramp, pause: r.pause, severity: r.severity, easy_days: r.easyDays, no_quality: r.noQualityDays, until: r.until, factor: Math.round(r.factor * 100), easy: r.easy, quality_blocked: r.noQuality, weight_scale: r.weightScale, doctor: !!r.doctor, end: r.end } };
  }
  return base;
}

/** Hinweistexte (Nackenregel) für Oberfläche und Plan. */
export const NECK_RULE = 'Nackenregel: Bei Beschwerden nur oberhalb des Halses (Schnupfen, Halskratzen) ist lockeres Training in Ordnung. Bei Fieber, Husten in der Brust oder Gliederschmerzen ruht der Sport. Nach Fieber mindestens 24 bis 48 Stunden fieberfrei, bevor du wieder startest.';
