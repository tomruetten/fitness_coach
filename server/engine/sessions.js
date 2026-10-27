// Bausteine der Einheiten (Lauf A, Lauf B, Kraft). Reine Funktionen: Block und Woche rein, Einheit raus.
import { fmtPace } from './zones.js';

const range = (a, b) => `${a}–${b}`;
const kmAt = (min, paceS) => (min * 60) / paceS;
const round1 = (x) => Math.round(x * 10) / 10;

/** Zielwerte für Pace-Texte aus den Einstellungen. */
export function paces(settings) {
  const hm = settings.goal?.time_s && settings.goal?.distance_km ? settings.goal.time_s / settings.goal.distance_km : 313;
  return { lt: settings.lt_pace_s, hm: Math.round(hm), easy: settings.easy_pace_s };
}

const WU_MIN = 15;
const CD_MIN = 10;

// ---- Lauf A (Qualität) -----------------------------------------------------------------
// Je Block und Woche eine Struktur. `step` verkleinert sie bei mittlerer Erholung um eine Stufe.
const QUALITY = {
  basis: [
    { type: 'strides', easyMin: 35, reps: 6, repS: 20 },
    { type: 'fartlek', reps: 6, repS: 60, recS: 120 },
    { type: 'strides', easyMin: 40, reps: 8, repS: 20 },
    { type: 'strides', easyMin: 30, reps: 4, repS: 20 }, // Entlastung
  ],
  aufbau: [
    { type: 'threshold', reps: 3, repMin: 8, recMin: 2 },
    { type: 'threshold', reps: 3, repMin: 10, recMin: 2 },
    { type: 'threshold', reps: 2, repMin: 15, recMin: 3 },
    { type: 'threshold', reps: 3, repMin: 8, recMin: 2 }, // Entlastung
    { type: 'threshold', reps: 4, repMin: 10, recMin: 2 },
  ],
  spezifisch: [
    { type: 'hm', reps: 2, repKm: 4, recKm: 1 },
    { type: 'hm', reps: 2, repKm: 5, recKm: 1 },
    { type: 'hm', reps: 4, repKm: 2, recKm: 0.5 },
  ],
  taper: [{ type: 'hm', reps: 4, repKm: 1, recKm: 0.5 }],
};

function stepDown(q) {
  const out = { ...q };
  if (q.type === 'threshold') out.reps = Math.max(2, q.reps - 1);
  else if (q.type === 'hm') out.reps = Math.max(2, q.reps - 1);
  else if (q.type === 'fartlek') out.reps = Math.max(4, q.reps - 2);
  else out.reps = Math.max(4, q.reps - 2);
  return out;
}

export function runQuality(block, settings, { step = false } = {}) {
  const list = QUALITY[block.name];
  let q = list[Math.min(block.week, list.length) - 1];
  if (step) q = stepDown(q);
  const p = paces(settings);
  const easyKm = (m) => kmAt(m, p.easy);
  const steps = [{ label: 'Einlaufen', detail: `${WU_MIN} min locker, Puls bis ${settings._z2to}` }];
  let km = easyKm(WU_MIN) + easyKm(CD_MIN);
  let title;
  let summary;
  if (q.type === 'strides') {
    steps.push({ label: 'Lockerer Dauerlauf', detail: `${q.easyMin} min im Z2-Bereich (${settings._z2from}–${settings._z2to} bpm)` });
    steps.push({ label: 'Steigerungsläufe', detail: `${q.reps} × ${q.repS} s flott (ca. ${fmtPace(p.lt - 25)} min/km), 60 s Gehpause` });
    km += easyKm(q.easyMin) + (q.reps * q.repS) / (p.lt - 25); // Strecke der Steigerungen
    title = 'Locker mit Steigerungen';
    summary = 'Aerobe Grundlage und Lauftechnik: locker laufen, am Ende kurze, entspannte Beschleunigungen.';
  } else if (q.type === 'fartlek') {
    steps.push({ label: 'Fahrtspiel', detail: `${q.reps} × ${q.repS / 60} min bei ca. ${fmtPace(p.lt - 8)} min/km, dazwischen ${q.recS / 60} min locker` });
    km += (q.reps * q.repS) / (p.lt - 8) + (q.reps * q.recS) / p.easy;
    title = 'Fahrtspiel';
    summary = 'Kurze Tempowechsel um die Schwelle, aber ohne die Beine zu belasten.';
  } else if (q.type === 'threshold') {
    steps.push({ label: 'Schwellenintervalle', detail: `${q.reps} × ${q.repMin} min bei ${fmtPace(p.lt)} min/km (Puls ${settings._z4from}–${settings.lthr} bpm), ${q.recMin} min locker traben` });
    km += (q.reps * q.repMin * 60) / p.lt + ((q.reps - 1) * q.recMin * 60) / p.easy;
    title = `Schwelle ${q.reps} × ${q.repMin} min`;
    summary = 'Tempo an der Laktatschwelle: gleichmäßig und kontrolliert, nicht schneller als die Zielpace.';
  } else {
    steps.push({ label: 'Halbmarathon-Tempo', detail: `${q.reps} × ${q.repKm} km bei ${fmtPace(p.hm)} min/km, ${q.recKm} km locker dazwischen` });
    km += q.reps * q.repKm + (q.reps - 1) * q.recKm;
    title = `Zieltempo ${q.reps} × ${q.repKm} km`;
    summary = 'Das Renntempo trainieren: gleichmäßig, entspannt und mit klarer Form.';
  }
  steps.push({ label: 'Auslaufen', detail: `${CD_MIN} min locker` });
  return {
    title, summary, steps,
    targets: { distance_km: round1(km), pace_s: q.type === 'threshold' ? p.lt : q.type === 'hm' ? p.hm : null, hr_from: settings._z4from, hr_to: settings.lthr },
    structure: q,
  };
}

export function runEasy(minutes, settings, why = 'Lockerer Lauf') {
  const km = kmAt(minutes, settings.easy_pace_s);
  return {
    title: why,
    summary: `Locker laufen, Puls im Z1/Z2-Bereich (bis ${settings._z2to} bpm). Das Gespräch muss möglich bleiben.`,
    steps: [{ label: 'Lockerer Dauerlauf', detail: `${minutes} min bei Puls bis ${settings._z2to} bpm` }],
    targets: { duration_min: minutes, distance_km: round1(km), hr_to: settings._z2to },
  };
}

// ---- Lauf B (lang) ---------------------------------------------------------------------
const LONG_KM = {
  basis: [12, 13, 14, 12],
  aufbau: [15, 16, 17, 15, 18],
  spezifisch: [18, 19, 16],
  taper: [8],
};
const LONG_FINISH_KM = { spezifisch: [4, 6, 0], aufbau: [0, 0, 3, 0, 4], basis: [0, 0, 0, 0], taper: [0] };

export function longRunKm(block) {
  const list = LONG_KM[block.name];
  return list[Math.min(block.week, list.length) - 1];
}

export function runLong(block, settings, { km, scale = 1 }) {
  const p = paces(settings);
  const finishList = LONG_FINISH_KM[block.name];
  let finish = finishList[Math.min(block.week, finishList.length) - 1] || 0;
  const total = Math.max(6, Math.round(km * scale));
  if (scale < 1) finish = 0;
  finish = Math.min(finish, Math.floor(total / 3));
  const steps = [{ label: 'Gleichmäßig locker', detail: `${total - finish} km bei Puls ${settings._z2from}–${settings._z2to} bpm (ca. ${fmtPace(p.easy)} min/km)` }];
  if (finish > 0) steps.push({ label: 'Endteil im Zieltempo', detail: `letzte ${finish} km bei ${fmtPace(p.hm)} min/km` });
  const minutes = Math.round(((total - finish) * p.easy + finish * p.hm) / 60);
  return {
    title: `Langer Lauf ${total} km`,
    summary: finish > 0 ? 'Ausdauer mit Endbeschleunigung im Renntempo.' : 'Ausdauer: ruhig und gleichmäßig, Tempo nicht erzwingen.',
    steps,
    targets: { distance_km: total, duration_min: minutes, pace_s: p.easy, hr_from: settings._z2from, hr_to: settings._z2to },
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
