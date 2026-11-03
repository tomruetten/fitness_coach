// Fortschrittslogik ohne festes Rennen: Umfang, Qualitätseinheit und langer Lauf werden aus dem Leistungsstand
// und den tatsächlich gelaufenen Einheiten abgeleitet.
//
// Wissenschaftliche Bausteine (Kurzfassung, Details im README):
//  - Belastungssteuerung: wöchentliche Steigerung höchstens ~10 %, Entlastungswoche nach drei Belastungswochen
//    (Periodisierung 3:1, Mujika & Padilla 2003: Umfang senken, Intensität erhalten); akut/chronisch-Verhältnis im
//    Bereich 0,8–1,3 (Gabbett 2016).
//  - Intensitätsverteilung: etwa 80 % locker, 20 % hart nach Zeit (Seiler 2010; Stöggl & Sperlich 2014). Das Spinning
//    am Dienstag zählt zur harten Zeit und verkleinert das Budget für die Lauf-Qualität.
//  - Tempi und Volumen der Qualitätseinheiten nach Daniels (Schwelle: Cruise-Intervalle mit 1 min Pause je 5 min
//    Arbeit; VO2max-Intervalle 3–5 min mit gleich langer Trabpause).
//  - Aufbau aus tatsächlich Gelaufenem: nächstes Volumen = zuletzt geschaffte Arbeit × 1,05–1,15, je nach Anstrengung.
import { addDays, diffDays, mondayOf } from './dates.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const isRun = (a) => a.sport === 'running' && a.distance_m > 1500;
const round5 = (x) => Math.round(x * 2) / 2;

export const weekKm = (activities, monday) => sum(activities.filter((a) => isRun(a) && a.local_date >= monday && a.local_date <= addDays(monday, 6)).map((a) => a.distance_m / 1000));

/** Umfang der laufenden Woche und Position im Vierwochen-Zyklus. */
export function weeklyPlan(activities, date, { level = 'good', acwr = null, startKm = 20 } = {}) {
  const m = mondayOf(date);
  const wk = (i) => weekKm(activities, addDays(m, -7 * i));
  const raw = [null, wk(1), wk(2), wk(3), wk(4), wk(5), wk(6), wk(7)];
  // Einzelne Ausreißerwochen (z. B. ein Wettkampf) verzerren Zyklus und Zielumfang nicht: auf 130 % des Medians begrenzt
  const med = median(raw.slice(1, 5).filter((v) => v > 0)) || 0;
  const w = raw.map((v) => (v == null || !med ? v : Math.min(v, med * 1.3)));
  const avg4 = sum([w[1], w[2], w[3], w[4]]) / 4;
  const runs4 = activities.filter((a) => isRun(a) && a.local_date >= addDays(m, -28) && a.local_date < m).length;
  const info = { avg4, runs4, last: w[1], w };

  if (w[1] + w[2] + w[3] + w[4] === 0) {
    return { ...info, target: startKm, c: 1, deload: false, reason: `Startumfang ${startKm} km pro Woche, weil in den letzten vier Wochen keine Läufe vorliegen`, g: 0 };
  }
  // Wachstumsrate je nach Erholung und Belastungsverhältnis
  let g = 0.10;
  let limit = null;
  if (level === 'medium') { g = 0.04; limit = 'Erholung nur mittel'; }
  if (level === 'low') { g = 0; limit = 'Erholung niedrig'; }
  if (acwr != null && acwr > 1.3) { g = Math.min(g, 0.02); limit = `Belastungsverhältnis ${acwr.toFixed(2)}`; }

  const deloadLast = w[1] > 0 && w[2] > 0 && w[1] < 0.85 * Math.max(w[2], w[3]);
  let loading = 0;
  for (let i = 1; i <= 6; i++) {
    const cur = w[i], prev = Math.max(w[i + 1] || 0, w[i + 2] || 0);
    if (cur <= 0 || (prev > 0 && cur < 0.85 * prev)) break;
    loading++;
  }
  const peak = Math.max(w[1], w[2], w[3]);
  let c = deloadLast ? 1 : loading + 1;
  let deload = c >= 4;
  if (deload) c = 4;
  let target, reason;

  const returning = w[1] < 0.6 * Math.max(w[2], w[3], w[4]) && !deloadLast && Math.max(w[2], w[3], w[4]) > 0;
  if (w[1] === 0 && w[2] === 0) {
    target = Math.max(10, round5(0.6 * Math.max(w[3], w[4])));
    c = 1; deload = false;
    reason = `Wiedereinstieg nach Pause: ${target} km, etwa 60 % deines früheren Umfangs`;
  } else if (returning) {
    target = Math.max(10, round5(Math.min(0.9 * avg4, w[1] * 1.25 + 2)));
    c = 1; deload = false;
    reason = `Letzte Woche nur ${w[1].toFixed(0)} km: behutsamer Wiederaufbau auf ${target} km`;
  } else if (deload) {
    target = Math.max(10, round5(0.78 * Math.max(w[1], w[2])));
    reason = `Entlastungswoche nach drei Belastungswochen: ${target} km (etwa −22 %), Intensität bleibt`;
  } else if (deloadLast) {
    target = round5(Math.max(w[2], w[3]) * 1.03);
    reason = `Neuer Zyklus: zurück auf dein Niveau vor der Entlastung, ${target} km`;
  } else {
    target = round5(w[1] * (1 + g));
    reason = g >= 0.1 ? `Wochenumfang +10 % gegen letzte Woche (${w[1].toFixed(0)} km) auf ${target} km`
      : g > 0 ? `Wochenumfang nur +${Math.round(g * 100)} % (${limit}): ${target} km`
        : `Wochenumfang gehalten (${limit}): ${target} km`;
    if (g === 0) target = round5(w[1]);
    if (level === 'low') target = round5(w[1] * 0.9);
  }
  // Der Umfang darf nie mehr als 10 % über dem Schnitt der letzten vier Wochen und der letzten Woche liegen
  if (!deload && !deloadLast && !returning) target = Math.min(target, round5(Math.max(w[1], avg4) * 1.1));
  return { ...info, target, c, deload, reason, g, limit, loading };
}

// ---- Qualitätshistorie -----------------------------------------------------------------------------

/** Was ein früherer Qualitätslauf tatsächlich geleistet hat. Läufe über 75 min und lange Läufe zählen nicht. */
export function qualityHistory(activities, fit, date, isLongDay) {
  const p = fit.paces;
  const out = [];
  for (const r of activities) {
    if (!isRun(r) || r.local_date >= date || diffDays(date, r.local_date) > 49) continue;
    if (r.duration_s > 75 * 60 || isLongDay(r.local_date)) continue;
    const segs = r.best?.v === 2 ? r.best.segments || [] : null;
    if (segs) {
      const hard = segs.filter((s) => s.pace_s <= p.threshold * 1.06 && s.dur_s >= 90);
      const tot = sum(hard.map((s) => s.dur_s));
      if (tot < 360) continue;
      const pace = sum(hard.map((s) => s.pace_s * s.dur_s)) / tot;
      const hr = sum(hard.map((s) => s.hr * s.dur_s)) / tot;
      out.push({ date: r.local_date, type: pace <= p.interval * 1.04 ? 'vo2' : 'threshold', workMin: tot / 60, reps: hard.length, repMin: median(hard.map((s) => s.dur_s)) / 60, pace_s: Math.round(pace), hr: Math.round(hr), rpe: r.rpe ?? null, exact: true });
    } else {
      const z = r.zone_s || [];
      const hardS = (z[3] || 0) + (z[4] || 0);
      if (hardS < 360) continue;
      // Ohne Abschnittsdaten: Zeit in Z4+Z5, wegen der Pulsverzögerung leicht hochgerechnet
      out.push({ date: r.local_date, type: (z[4] || 0) / hardS > 0.4 ? 'vo2' : 'threshold', workMin: (hardS * 1.15) / 60, reps: null, repMin: null, pace_s: null, hr: r.avg_hr, rpe: r.rpe ?? null, exact: false });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const fmtP = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/** Wöchentliche Trainingszeit und das, was Spinning an harter Zeit schon belegt. */
function timeBudget(activities, date) {
  const m = mondayOf(date);
  const weeks = [1, 2, 3, 4].map((i) => {
    const from = addDays(m, -7 * i), to = addDays(from, 6);
    const inW = activities.filter((a) => a.local_date >= from && a.local_date <= to && (a.sport === 'running' || a.sport === 'cycling'));
    const total = sum(inW.map((a) => a.duration_s)) / 60;
    const hardCycle = sum(inW.filter((a) => a.sport === 'cycling').map((a) => ((a.zone_s?.[3] || 0) + (a.zone_s?.[4] || 0)) / 60));
    return { total, hardCycle };
  }).filter((w) => w.total > 0);
  const tw = weeks.length ? sum(weeks.map((w) => w.total)) / weeks.length : 150;
  const sp = weeks.length ? median(weeks.map((w) => w.hardCycle)) : 15;
  return { tw, spin: sp, budget: clamp(0.2 * tw - sp, 12, 40) };
}

const cruise = (v) => {
  // Wiederholungslänge 5–15 min (Daniels); gewählt wird die Kombination, die das Zielvolumen am genauesten trifft
  // (nie mehr als 5 % darunter, damit die Progression nicht durch Rundung stehen bleibt).
  let best = null;
  for (let rep = 5; rep <= 15; rep++) {
    if (v >= 20 && rep < 8) continue;
    if (v < 16 && rep > 8) continue;
    for (let reps = 2; reps <= 6; reps++) {
      const tot = reps * rep;
      if (tot < v * 0.95) continue;
      const d = Math.abs(tot - v) + 0.3 * Math.abs(reps - 3.5);
      if (!best || d < best.d) best = { d, reps, rep };
    }
  }
  best = best || { reps: 3, rep: Math.round(v / 3) };
  return { type: 'threshold', reps: best.reps, repMin: best.rep, recMin: Math.max(1, Math.round(best.rep / 5)) };
};
const vo2set = (v) => {
  const repMin = v <= 15 ? 3 : 4;
  const reps = clamp(Math.round(v / repMin), 4, 6);
  return { type: 'vo2', reps, repMin, recMin: repMin };
};

/**
 * Entscheidet Art und Umfang der Qualitätseinheit.
 * @returns {{structure:object, why:Array<{rule:string,text:string}>, kind:string}}
 */
export function planQuality({ activities, date, fit, rd, wp, pain, isLongDay, provisional, volScale = 1 }) {
  const why = [];
  const hist = qualityHistory(activities, fit, date, isLongDay);
  const last = hist[0] || null;
  const tb = timeBudget(activities, date);
  const consistent = wp.runs4 >= 6 && wp.avg4 >= 12;
  const good = provisional || rd.level === 'good';
  const allowVo2 = consistent && wp.avg4 >= 20 && fit.confidence !== 'niedrig' && good && !pain;
  const c = wp.c;

  if (last) {
    const bits = [`${last.reps ? `${last.reps} × ${last.repMin.toFixed(0)} min` : `${last.workMin.toFixed(0)} min hart`}`, last.pace_s ? `Ø ${fmtP(last.pace_s)} /km` : null, last.hr ? `Ø-Puls ${last.hr}` : null, last.rpe != null ? `Anstrengung ${last.rpe}` : null].filter(Boolean);
    why.push({ rule: 'R-LASTQ', text: `Letzte Qualitätseinheit (${dm(last.date)}, ${last.type === 'vo2' ? 'VO2max' : 'Schwelle'}): ${bits.join(', ')}` });
  }

  // Nicht bereit für Intensität: erst Regelmäßigkeit aufbauen
  if (!consistent) {
    why.push({ rule: 'R-TYPE', text: `Erst Regelmäßigkeit aufbauen (${wp.runs4} ${wp.runs4 === 1 ? 'Lauf' : 'Läufe'} in 4 Wochen, Ziel: 6): lockerer Lauf mit Steigerungen statt harter Intervalle` });
    return { kind: 'strides', structure: { type: 'strides', easyMin: 35, reps: 6, repS: 20 }, why, hist, tb };
  }

  // Art der Einheit: Zyklus T → VO2max → Tempodauerlauf bzw. Test → Entlastung (Intensität bleibt, Volumen sinkt)
  const T = hist.find((h) => h.type === 'threshold');
  const I = hist.find((h) => h.type === 'vo2');
  let type = 'threshold';
  if (wp.deload) type = 'threshold';
  else if (c === 2 && allowVo2) type = 'vo2';
  else if (c >= 3) type = 'tempo';
  const tested = activities.some((a) => isRun(a) && a.local_date < date && diffDays(date, a.local_date) <= 35 && a.best?.m30 && a.best.m30.hr / fit.lthr >= 0.94);
  const testDue = !wp.deload && good && !pain && !tested && wp.avg4 >= 15 && (fit.evidenceDays == null || fit.evidenceDays > 35) && (c >= 3 || (fit.evidenceDays ?? 99) > 56);
  if (testDue) type = 'test30';
  if (!allowVo2 && c === 2) why.push({ rule: 'R-TYPE', text: 'VO2max-Intervalle noch nicht freigegeben (Umfang unter 20 km pro Woche, zu wenig Belege oder Erholung): Schwellentraining' });

  // Volumen: zuletzt Geschafftes × Faktor
  const factor = (h) => {
    if (!h) return 1;
    if (h.rpe != null && h.rpe >= 9) return 0.9;
    if (h.pace_s && h.hr && h.hr > fit.lthr + 4) return 0.95;
    if (h.rpe != null && h.rpe <= 6) return 1.12;
    return 1.08;
  };
  let vT = (T ? T.workMin * factor(T) : 14);
  if (!wp.deload && T && last === T) why.push({ rule: 'R-PROG', text: `Schwellenvolumen: ${T.workMin.toFixed(0)} min zuletzt → ${Math.round(vT)} min (${factor(T) >= 1.1 ? '+12 %, letzte Einheit fühlte sich leicht an' : factor(T) < 1 ? 'reduziert, letzte Einheit war sehr hart' : '+8 %'})` });
  let vI = I ? I.workMin * factor(I) : 12;
  const cap = tb.budget;
  if (provisional === false && rd.level === 'medium') { vT *= 0.8; vI *= 0.8; }
  vT *= volScale; vI *= volScale;
  vT = clamp(vT, 10, Math.min(40, cap));
  vI = clamp(vI, 10, Math.min(24, cap));
  if (wp.deload) { vT *= 0.6; vI *= 0.6; why.push({ rule: 'R-DELOAD', text: 'Entlastungswoche: gleiche Intensität, etwa 40 % weniger Intervallzeit' }); }
  if (vT >= cap - 0.5) why.push({ rule: 'R-BUDGET', text: `Harte Zeit begrenzt: höchstens 20 % deiner Wochen-Trainingszeit (${Math.round(tb.tw)} min, davon Spinning etwa ${Math.round(tb.spin)} min hart) → ${Math.round(cap)} min für Lauf-Qualität` });

  let structure;
  if (type === 'threshold') structure = cruise(vT);
  else if (type === 'tempo') structure = { type: 'tempo', workMin: clamp(Math.round(Math.max(vT, 15)), 15, 35) };
  else if (type === 'vo2') structure = vo2set(vI);
  else structure = { type: 'test30' };
  if (type === 'tempo') why.push({ rule: 'R-TYPE', text: 'Dritte Belastungswoche: durchgehender Tempodauerlauf an der Schwelle' });
  if (type === 'vo2') why.push({ rule: 'R-TYPE', text: 'Zweite Belastungswoche: VO2max-Intervalle verbessern die maximale Sauerstoffaufnahme' });
  if (type === 'test30') why.push({ rule: 'R-TEST', text: `${fit.evidenceDays == null ? 'Noch keine harte Leistung als Beleg' : `Seit ${fit.evidenceDays} Tagen keine harte Leistung als Beleg`}: Der 30-Minuten-Test aktualisiert deinen Leistungsstand und die Tempi` });
  return { kind: type, structure, why, hist, tb };
}

/** Langer Lauf: Wochenziel minus schon Gelaufenes, begrenzt durch längsten Lauf, Zeit und Entkopplung. */
export function planLong({ activities, date, fit, rd, wp, qualityKm, provisional }) {
  const why = [];
  const m = mondayOf(date);
  const doneKm = sum(activities.filter((a) => isRun(a) && a.local_date >= m && a.local_date < date).map((a) => a.distance_m / 1000));
  const before = doneKm > 0 ? doneKm : qualityKm;
  let km = wp.target - before;
  why.push({ rule: 'R-VOL', text: wp.reason });

  const recent = activities.filter((a) => isRun(a) && a.local_date < date && diffDays(date, a.local_date) <= 28);
  const longest = Math.max(0, ...recent.map((a) => a.distance_m / 1000));
  const maxByJump = longest > 0 ? Math.max(longest * 1.1, longest + 1) : 12;
  const maxByTime = (150 * 60) / fit.paces.easy;
  let hold = false;
  const lastLong = [...recent].filter((a) => a.duration_s >= 3600 && a.best?.drift).sort((a, b) => b.local_date.localeCompare(a.local_date))[0];
  if (lastLong && lastLong.best.drift.steady) {
    const d = lastLong.best.drift.pct;
    if (d > 6) { hold = true; why.push({ rule: 'R-DRIFT', text: `Entkopplung im langen Lauf am ${dm(lastLong.local_date)}: ${d.toFixed(1)} % (über 5 %): Länge halten, Grundlage festigen` }); }
    else if (d < 3) why.push({ rule: 'R-DRIFT', text: `Entkopplung im langen Lauf am ${dm(lastLong.local_date)}: ${d.toFixed(1)} %: aerobe Grundlage trägt, Steigerung freigegeben` });
  }
  let cap = Math.min(maxByJump, maxByTime);
  if (hold && lastLong) cap = Math.min(cap, lastLong.distance_m / 1000);
  if (km > cap) { why.push({ rule: 'R-LONG', text: `Länge begrenzt: höchstens +10 % gegen deinen längsten Lauf der letzten 4 Wochen (${longest.toFixed(1)} km) und 150 min Dauer → ${Math.round(cap)} km` }); km = cap; }
  km = Math.max(8, Math.round(km));

  // Endbeschleunigung: ab der zweiten Belastungswoche und bei guter Erholung
  let finish = null;
  if (!wp.deload && wp.c >= 2 && km >= 12 && (provisional || rd.level === 'good') && !hold) {
    const fk = Math.min(5, Math.max(2, Math.round(km * 0.2)));
    finish = wp.c === 2 ? { km: fk, pace_s: fit.paces.marathon, label: 'Marathontempo' } : { km: fk, pace_s: fit.paces.hm, label: 'Halbmarathontempo' };
    why.push({ rule: 'R-FINISH', text: `Letzte ${fk} km im ${finish.label}: trainiert das Schnellerwerden unter Ermüdung` });
  }
  return { km, finish, why };
}
