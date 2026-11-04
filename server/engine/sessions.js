// Bausteine der Einheiten (Lauf A, Lauf B, Kraft). Reine Funktionen: Struktur und Leistungsstand rein, Einheit raus.
import { fmtPace } from './zones.js';

const kmAt = (min, paceS) => (min * 60) / paceS;
const round1 = (x) => Math.round(x * 10) / 10;
const WU_MIN = 15;
const CD_MIN = 10;

/**
 * Qualitätslauf aus einer Struktur (siehe progression.js) und dem Leistungsstand `fit` (Tempi in s/km).
 */
export function buildQuality(q, fit, settings) {
  const p = fit.paces;
  const easyKm = (m) => kmAt(m, p.easy);
  const steps = [{ label: 'Einlaufen', detail: `${WU_MIN} min locker, Puls bis ${settings._z2to}` }];
  let km = easyKm(WU_MIN) + easyKm(CD_MIN);
  let title, summary, pace = null;
  const hrWork = `Puls ${settings._z4from}–${settings.lthr} bpm`;
  if (q.type === 'strides') {
    steps.push({ label: 'Lockerer Dauerlauf', detail: `${q.easyMin} min im Z2-Bereich (${settings._z2from}–${settings._z2to} bpm)` });
    steps.push({ label: 'Steigerungsläufe', detail: `${q.reps} × ${q.repS} s flott (ca. ${fmtPace(p.rep)} min/km), 60 s Gehpause` });
    km += easyKm(q.easyMin) + (q.reps * q.repS) / p.rep;
    title = 'Locker mit Steigerungen';
    summary = 'Aerobe Grundlage und Lauftechnik: locker laufen, am Ende kurze, entspannte Beschleunigungen.';
  } else if (q.type === 'threshold') {
    steps.push({ label: 'Schwellenintervalle', detail: `${q.reps} × ${q.repMin} min bei ${fmtPace(p.threshold)} min/km (${hrWork}), ${q.recMin} min locker traben` });
    km += (q.reps * q.repMin * 60) / p.threshold + ((q.reps - 1) * q.recMin * 60) / p.easy;
    title = `Schwelle ${q.reps} × ${q.repMin} min`;
    summary = 'Cruise-Intervalle an der Laktatschwelle: gleichmäßig und kontrolliert, nicht schneller als die Zielpace.';
    pace = p.threshold;
  } else if (q.type === 'tempo') {
    steps.push({ label: 'Tempodauerlauf', detail: `${q.workMin} min durchgehend bei ${fmtPace(p.threshold)} min/km (${hrWork})` });
    km += (q.workMin * 60) / p.threshold;
    title = `Tempodauerlauf ${q.workMin} min`;
    summary = 'Gleichmäßig an der Schwelle, ohne Pause: trainiert, das Tempo lange zu halten.';
    pace = p.threshold;
  } else if (q.type === 'vo2') {
    steps.push({ label: 'VO2max-Intervalle', detail: `${q.reps} × ${q.repMin} min bei ${fmtPace(p.interval)} min/km, ${q.recMin} min locker traben. Nach Pace laufen, der Puls steigt erst gegen Ende auf ${Math.round(settings.lthr * 0.97)}–${settings.max_hr} bpm` });
    km += (q.reps * q.repMin * 60) / p.interval + ((q.reps - 1) * q.recMin * 60) / p.easy;
    title = `VO2max ${q.reps} × ${q.repMin} min`;
    summary = 'Schnelle, kurze Intervalle verbessern die maximale Sauerstoffaufnahme. Kontrolliert starten, die letzte Wiederholung wie die erste.';
    pace = p.interval;
  } else if (q.type === 'racepace') {
    steps.push({ label: 'Renntempo-Intervalle', detail: `${q.reps} × ${q.repMin} min bei ${fmtPace(q.pace_s)} min/km (Halbmarathon-Zielpace), ${q.recMin} min locker traben` });
    km += (q.reps * q.repMin * 60) / q.pace_s + ((q.reps - 1) * q.recMin * 60) / p.easy;
    title = `Renntempo ${q.reps} × ${q.repMin} min`;
    summary = 'Das Tempo, das du im Rennen laufen willst, in Abschnitten: Gefühl für die Pace und Ökonomie bei Renngeschwindigkeit.';
    pace = q.pace_s;
  } else {
    steps.push({ label: '30-Minuten-Test', detail: `30 min so gleichmäßig schnell wie möglich laufen. Erster Kilometer ca. ${fmtPace(p.test30 + 4)} min/km, dann Tempo halten, Erwartung etwa ${fmtPace(p.test30)} min/km` });
    km += (30 * 60) / p.test30;
    title = '30-Minuten-Test';
    summary = 'Zeitfahren über 30 min (Friel): Durchschnittspuls der letzten 20 min = deine Schwelle, Pace und Puls aktualisieren Leistungsstand und Tempi.';
    pace = p.test30;
  }
  steps.push({ label: 'Auslaufen', detail: `${CD_MIN} min locker` });
  const seg = (m, k, pace) => ({ m: Math.round(m * 100) / 100, k, pace_s: pace ? Math.round(pace) : null });
  const rep = (n, w, wk, wp, rec) => Array.from({ length: n }, (_, i) => [seg(w, wk, wp), ...(i < n - 1 ? [seg(rec, 'rec', p.easy)] : [])]).flat();
  const profile = [seg(WU_MIN, 'easy', p.easy)];
  if (q.type === 'strides') profile.push(seg(q.easyMin, 'easy', p.easy), ...Array.from({ length: q.reps }, () => [seg(q.repS / 60, 'rep', p.rep), seg(1, 'rec', p.easy)]).flat());
  else if (q.type === 'threshold') profile.push(...rep(q.reps, q.repMin, 'thr', p.threshold, q.recMin));
  else if (q.type === 'tempo') profile.push(seg(q.workMin, 'thr', p.threshold));
  else if (q.type === 'vo2') profile.push(...rep(q.reps, q.repMin, 'int', p.interval, q.recMin));
  else if (q.type === 'racepace') profile.push(...rep(q.reps, q.repMin, 'mar', q.pace_s, q.recMin));
  else profile.push(seg(30, 'thr', p.test30));
  profile.push(seg(CD_MIN, 'easy', p.easy));
  return { title, summary, steps, profile, targets: { distance_km: round1(km), pace_s: pace, hr_from: settings._z4from, hr_to: settings.lthr }, structure: q };
}

export function runEasy(minutes, fit, settings, why = 'Lockerer Lauf') {
  const km = kmAt(minutes, fit.paces.easy);
  return {
    title: why,
    summary: `Locker laufen, Puls im Z1/Z2-Bereich (bis ${settings._z2to} bpm). Das Gespräch muss möglich bleiben.`,
    steps: [{ label: 'Lockerer Dauerlauf', detail: `${minutes} min bei Puls bis ${settings._z2to} bpm` }],
    profile: [{ m: minutes, k: 'easy', pace_s: fit.paces.easy }],
    targets: { duration_min: minutes, distance_km: round1(km), hr_to: settings._z2to },
  };
}

/** Langer Lauf mit optionaler Endbeschleunigung `finish` ({km, pace_s, label}). */
export function runLong(km, finish, fit, settings, { scale = 1 } = {}) {
  const total = Math.max(6, Math.round(km * scale));
  const fin = scale < 1 || !finish ? null : { ...finish, km: Math.min(finish.km, Math.floor(total / 3)) };
  const steps = [{ label: 'Gleichmäßig locker', detail: `${total - (fin?.km || 0)} km bei Puls ${settings._z2from}–${settings._z2to} bpm (ca. ${fmtPace(fit.paces.easy)} min/km)` }];
  if (fin && fin.km > 0) steps.push({ label: `Endteil im ${fin.label}`, detail: `letzte ${fin.km} km bei ${fmtPace(fin.pace_s)} min/km` });
  const minutes = Math.round((((total - (fin?.km || 0)) * fit.paces.easy) + (fin?.km || 0) * (fin?.pace_s || 0)) / 60);
  return {
    title: `Langer Lauf ${total} km`,
    summary: fin && fin.km > 0 ? 'Ausdauer mit Endbeschleunigung: Schneller werden, wenn die Beine müde sind.' : 'Ausdauer: ruhig und gleichmäßig, Tempo nicht erzwingen.',
    steps,
    profile: [{ m: Math.round(((total - (fin?.km || 0)) * fit.paces.easy) / 60), k: 'easy', pace_s: fit.paces.easy }, ...(fin && fin.km > 0 ? [{ m: Math.round((fin.km * fin.pace_s) / 60), k: fin.pace_s <= fit.paces.threshold + 8 ? 'thr' : 'mar', pace_s: fin.pace_s }] : [])],
    targets: { distance_km: total, duration_min: minutes, pace_s: fit.paces.easy, hr_from: settings._z2from, hr_to: settings._z2to },
  };
}

// ---- Kraft ----------------------------------------------------------------------------
// Einbeinige Übungen stehen im Vordergrund (Knie-Stabilität), dazu Waden und Core.
const STRENGTH = {
  strength_a: [
    { id: 'split_squat', name: 'Bulgarische Split-Kniebeuge', sets: 3, reps: '8 je Bein', weighted: true, leg: true },
    { id: 'sl_rdl', name: 'Einbeiniges Kreuzheben', sets: 3, reps: '8 je Bein', weighted: true, leg: true },
    { id: 'step_up', name: 'Step-ups (hohe Stufe)', sets: 3, reps: '8 je Bein', weighted: true, leg: true },
    { id: 'calf_straight', name: 'Wadenheben, Knie gestreckt', sets: 3, reps: '12', weighted: true, leg: false },
    { id: 'calf_bent', name: 'Wadenheben, Knie gebeugt', sets: 3, reps: '12', weighted: true, leg: false },
    { id: 'side_plank', name: 'Seitstütz', sets: 3, reps: '30 s je Seite', weighted: false, leg: false },
    { id: 'dead_bug', name: 'Dead Bug', sets: 3, reps: '8 je Seite', weighted: false, leg: false },
  ],
  strength_b: [
    { id: 'sl_hip_thrust', name: 'Einbeiniger Hip Thrust', sets: 3, reps: '10 je Bein', weighted: true, leg: true },
    { id: 'hip_abduction', name: 'Hüftabduktion im Stand (Band)', sets: 3, reps: '15 je Seite', weighted: false, leg: false },
    { id: 'pallof', name: 'Pallof Press', sets: 3, reps: '10 je Seite', weighted: true, leg: false },
    { id: 'copenhagen', name: 'Copenhagen Plank', sets: 3, reps: '20 s je Seite', weighted: false, leg: false },
    { id: 'sl_calf', name: 'Einbeiniges Wadenheben', sets: 3, reps: '12 je Bein', weighted: true, leg: false },
    { id: 'bird_dog', name: 'Bird Dog', sets: 3, reps: '8 je Seite', weighted: false, leg: false },
  ],
};
const POGO = { id: 'pogo', name: 'Pogo-Sprünge (leicht)', sets: 3, reps: '20', weighted: false, leg: true };

/** Auf Basis des letzten Logs einen Lastvorschlag ableiten. */
export function suggestLoad(lastLog) {
  if (!lastLog || lastLog.weight_kg == null) return null;
  const ok = lastLog.done_all && (lastLog.rpe == null || lastLog.rpe <= 7);
  if (ok) return { weight_kg: Math.round((lastLog.weight_kg * 1.05) / 2.5) * 2.5 || lastLog.weight_kg + 2.5, note: 'Letzte Einheit sauber geschafft, leichte Steigerung' };
  return { weight_kg: lastLog.weight_kg, note: 'Gewicht halten' };
}

/**
 * @param {'strength_a'|'strength_b'} kind
 * @param {{block:object, level:'full'|'reduced'|'light'|'min', lastLogs?:Record<string,object>, legLight?:boolean, maxMin:number}} o
 */
export function strengthSession(kind, o) {
  const base = STRENGTH[kind].map((e) => ({ ...e }));
  if (kind === 'strength_b' && (o.block.name === 'aufbau' || o.block.name === 'spezifisch')) base.splice(4, 0, { ...POGO });
  const cut = { full: 0, reduced: 1, light: 1, min: 2 }[o.level];
  const exercises = base.map((e) => {
    let sets = e.sets - cut;
    if (o.legLight && e.leg) sets = Math.max(1, Math.min(sets, 2));
    sets = Math.max(1, sets);
    const sug = e.weighted && o.level === 'full' && !o.legLight ? suggestLoad(o.lastLogs?.[e.id]) : null;
    const last = o.lastLogs?.[e.id];
    return {
      id: e.id, name: e.name, sets, reps: e.reps,
      weight_kg: o.level === 'full' && !o.legLight ? sug?.weight_kg ?? last?.weight_kg ?? null : o.legLight ? null : last?.weight_kg ?? null,
      note: sug?.note || (o.legLight && e.leg ? 'Nur mit Körpergewicht, die Beine sind vom Spinning müde' : null),
    };
  });
  const minutes = Math.min(o.maxMin, Math.round(10 + exercises.reduce((a, e) => a + e.sets * 3.2, 0)));
  const aA = kind === 'strength_a';
  return {
    title: aA ? 'Kraft A: Beine einbeinig und Core' : 'Kraft B: Hüfte, Waden und Core',
    summary: aA
      ? 'Stabilität für Knie und Laufbewegung: einbeinige Übungen, kontrolliert und ohne Schwung.'
      : 'Wenig Beinlast nach dem langen Lauf: Hüftstabilität, Waden und Rumpf.',
    exercises,
    targets: { duration_min: minutes },
  };
}
