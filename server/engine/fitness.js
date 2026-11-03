// Leistungsstand aus echten Läufen. Grundlage ist das VDOT-Modell von Daniels & Gilbert (1979):
//   VO2(v)   = -4,60 + 0,182258·v + 0,000104·v²           (v in m/min, ml/kg/min)
//   %VO2max(t) = 0,80 + 0,1894393·e^(-0,012778·t) + 0,2989558·e^(-0,1932605·t)   (t in min)
//   VDOT     = VO2(v) / %VO2max(t)
// Aus einer harten Leistung über eine bekannte Dauer folgt so ein „effektives VO2max“, aus dem sich Trainings-
// und Wettkampftempi ableiten lassen. Zusätzlich wird der Puls genutzt (VO2-Reserve ≈ Pulsreserve nach Swain
// et al. 1994), um Veränderungen auch zwischen harten Läufen zu erkennen.
import { diffDays } from './dates.js';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const vo2OfSpeed = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v; // v in m/min
export const pctMax = (tMin) => 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);

/** VDOT aus einer Leistung: Strecke in m, Zeit in s. */
export function vdotOf(distM, timeS) {
  const t = timeS / 60;
  return vo2OfSpeed(distM / t) / pctMax(t);
}

/** Geschwindigkeit (m/min), bei der die Sauerstoffaufnahme `vo2` beträgt. */
export function speedAtVo2(vo2) {
  const a = 0.000104, b = 0.182258, c = -(4.6 + vo2);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** Pace (s/km) bei einem Anteil `f` des VO2max. */
export const paceAtFrac = (vdot, f) => 60000 / speedAtVo2(vdot * f);

/** Prognosezeit (s) über `distM` bei gegebenem VDOT. */
export function predictTime(vdot, distM) {
  let lo = distM / 450, hi = distM / 50; // Minuten; 450 m/min liegt über dem Weltrekordtempo
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotOf(distM, mid * 60) > vdot) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 60);
}

/** Aus der Schwellenpace (Daniels: etwa 88 % VO2max) einen VDOT als Ausgangswert ableiten. */
export const vdotFromThresholdPace = (paceS) => vo2OfSpeed(60000 / paceS) / 0.88;

const EFFORTS = [
  // Schlüssel, Dauer s, Mindestpuls (Anteil LTHR), Zielpuls für vollen Einsatz (null = keine Korrektur)
  ['m5', 300, 0.93, null],
  ['m10', 600, 0.94, null],
  ['m20', 1200, 0.95, 1.01],
  ['m30', 1800, 0.96, 1.0],
  ['m60', 3600, 0.95, 1.0],
];

/** Leistungsbelege eines Laufs: harte Bestleistungen und ganze Läufe (Wettkampf, Tempodauerlauf). */
export function effortsOf(run, lthr) {
  const out = [];
  const b = run.best || {};
  const push = (kind, durS, paceS, hr, target) => {
    if (!paceS || !hr || paceS < 150 || paceS > 600) return;
    const ratio = hr / lthr;
    let pace = paceS;
    if (target) {
      const adj = clamp(target - ratio, 0, 0.03); // knapp unter Zielpuls: Leistung leicht hochrechnen
      pace = paceS / (1 + adj);
    }
    const dist = (durS / pace) * 1000;
    const v = vdotOf(dist, durS);
    if (v < 25 || v > 80) return;
    out.push({ date: run.local_date, kind, dur_s: durS, pace_s: Math.round(pace), hr, vdot: v });
  };
  for (const [k, dur, minRatio, target] of EFFORTS) {
    const e = b[k];
    if (e && e.hr / lthr >= minRatio) push(k, dur, e.pace_s, e.hr, target);
  }
  if (run.distance_m >= 4500 && run.distance_m <= 45000 && run.duration_s >= 1080 && run.avg_hr && run.avg_hr / lthr >= 0.95) {
    push('run', run.duration_s, (run.duration_s / run.distance_m) * 1000, run.avg_hr, 1.0);
  }
  return out;
}

/** VO2max-Schätzung je Kilometer aus Tempo und Puls (nur mittlere bis hohe Pulsbereiche). */
function hrSplitVdots(run, { rhr, maxHr }) {
  const out = [];
  for (const s of run.km_splits || []) {
    if (s.km < 2 || !s.hr || !s.pace_s || s.pace_s < 240 || s.pace_s > 480) continue;
    const f = (s.hr - rhr) / (maxHr - rhr);
    if (f < 0.6 || f > 0.92) continue;
    out.push(3.5 + (vo2OfSpeed(60000 / s.pace_s) - 3.5) / f);
  }
  return out;
}

const isRun = (a) => a.sport === 'running' && a.distance_m > 1500;

/**
 * Leistungsstand zu einem Stichtag.
 * @param {{activities:Array, days?:Array, settings:object, asOf:string}} o
 */
export function fitnessState({ activities, days = [], settings, asOf }) {
  const lthr = settings.lthr;
  const runs = activities.filter((a) => isRun(a) && diffDays(asOf, a.local_date) >= 0 && diffDays(asOf, a.local_date) <= 84);
  const rhrVals = days.filter((d) => diffDays(asOf, d.date) >= 0 && diffDays(asOf, d.date) <= 30 && Number.isFinite(d.resting_hr)).map((d) => d.resting_hr);
  const rhr = rhrVals.length ? median(rhrVals) : 55;
  const maxHr = settings.max_hr;

  // 1. Harte Leistungen mit Alterungsabschlag (nach ~3 Wochen ohne neuen Beleg −0,5 % je Woche, höchstens −7 %)
  const cands = runs.flatMap((r) => effortsOf(r, lthr)).map((e) => {
    const weeks = diffDays(asOf, e.date) / 7;
    return { ...e, eff: e.vdot * clamp(1 - 0.005 * Math.max(0, weeks - 3), 0.93, 1) };
  }).sort((a, b) => b.eff - a.eff);
  let perf = null;
  if (cands.length) {
    perf = cands[0].eff;
    // Ausreißerschutz: ein einzelner Wert deutlich über allen anderen (GPS-Fehler) zählt nur anteilig
    if (cands.length >= 3 && cands[0].eff > cands[1].eff * 1.04) perf = cands[1].eff * 1.02;
  }
  const anchor = cands[0] || null;

  // 2. Puls-Tempo-Verhalten: Median der VO2max-Schätzungen der letzten 21 Tage gegen die 21 Tage um den Beleg
  const winRuns = (centerDate, span) => runs.filter((r) => Math.abs(diffDays(centerDate, r.local_date)) <= span);
  const recentHr = runs.filter((r) => diffDays(asOf, r.local_date) <= 21).flatMap((r) => hrSplitVdots(r, { rhr, maxHr }));
  const refHr = anchor ? winRuns(anchor.date, 21).flatMap((r) => hrSplitVdots(r, { rhr, maxHr })) : [];
  let trend = null;
  if (recentHr.length >= 8 && refHr.length >= 8) {
    trend = clamp(median(recentHr) / median(refHr) - 1, -0.08, 0.06);
  }

  // 3. Ergebnis
  const prior = vdotFromThresholdPace(settings.lt_pace_s);
  let vdot, source, confidence;
  if (perf != null) {
    vdot = perf * (1 + (trend != null ? 0.6 * clamp(trend, -0.06, 0.04) : 0));
    const age = diffDays(asOf, anchor.date);
    confidence = age <= 28 && cands.length >= 2 ? 'hoch' : age <= 56 ? 'mittel' : 'niedrig';
    source = 'läufe';
  } else {
    vdot = prior; source = 'einstellungen'; confidence = 'niedrig';
  }
  vdot = Math.round(vdot * 10) / 10;

  // Tempi (s/km). Lockeres Tempo bevorzugt aus den eigenen Z2-Kilometern, sonst aus 65 % VO2max (Daniels E).
  const easyFromData = easyPaceFromRuns(runs, lthr, asOf);
  const eDaniels = paceAtFrac(vdot, 0.65);
  const easy = easyFromData ?? Math.round(clamp(settings.easy_pace_s || eDaniels, paceAtFrac(vdot, 0.74), paceAtFrac(vdot, 0.59)));
  const paces = {
    easy,
    easy_range: [Math.round(paceAtFrac(vdot, 0.74)), Math.round(paceAtFrac(vdot, 0.59))],
    marathon: Math.round(predictTime(vdot, 42195) / 42.195),
    hm: Math.round(predictTime(vdot, 21097.5) / 21.0975),
    threshold: Math.round(paceAtFrac(vdot, 0.88)),
    interval: Math.round(paceAtFrac(vdot, 0.98)),
    rep: Math.round(paceAtFrac(vdot, 1.08)),
    test30: Math.round(paceAtFrac(vdot, pctMax(30))),
  };
  const predictions = {
    k5: predictTime(vdot, 5000), k10: predictTime(vdot, 10000), hm: predictTime(vdot, 21097.5), m: predictTime(vdot, 42195),
  };
  return {
    vdot, lthr, prior: Math.round(prior * 10) / 10, source, confidence,
    perf: perf != null ? Math.round(perf * 10) / 10 : null,
    trend: trend != null ? Math.round(trend * 1000) / 10 : null, // % Veränderung des Puls-Tempo-Verhaltens
    anchor: anchor ? { date: anchor.date, kind: anchor.kind, vdot: Math.round(anchor.vdot * 10) / 10, pace_s: anchor.pace_s, hr: anchor.hr, dur_s: anchor.dur_s } : null,
    evidenceDays: anchor ? diffDays(asOf, anchor.date) : null,
    paces, predictions,
    basedOn: { efforts: cands.length, hrSplits: recentHr.length, runs: runs.length },
  };
}

/** Lockeres Tempo: Median der Z2-Kilometer der letzten 6 Wochen (mindestens 10 Kilometer). */
export function easyPaceFromRuns(runs, lthr, asOf) {
  const lo = Math.round(lthr * 0.85), hi = Math.round(lthr * 0.9);
  const xs = runs.filter((r) => diffDays(asOf, r.local_date) <= 42).flatMap((r) => (r.km_splits || []).filter((k) => k.km >= 2 && k.hr >= lo && k.hr < hi && k.pace_s > 240 && k.pace_s < 480).map((k) => k.pace_s));
  return xs.length >= 10 ? Math.round(median(xs)) : null;
}
