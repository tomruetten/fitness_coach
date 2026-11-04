// Rennmodus: Sobald eine Zielzeit MIT Datum gesetzt ist, richtet sich der Plan auf dieses Rennen aus.
// Ohne Datum bleibt alles beim kontinuierlichen Aufbau (siehe progression.js).
//
// Phasen nach Wochen bis zur Rennwoche (Montag bis Sonntag, in der das Rennen liegt):
//   12 und mehr    Basis        wie ohne Rennen
//   6 bis 11       Aufbau       wie ohne Rennen, lange Läufe enden im Renntempo statt im Halbmarathontempo
//   2 bis 5        Spezifisch   abwechselnd Renntempo-Intervalle und Schwelle, längere Endteile im langen Lauf, keine Entlastungswoche
//   1              Tapering     Umfang 75 % der Spitzenwoche, kurze Renntempo-Einheit, Intensität bleibt
//   0              Rennwoche    Umfang 50 %, nur Aktivierung, am Renntag die Wettkampfeinheit
import { diffDays, mondayOf } from './dates.js';
import { vdotOf, predictTime } from './fitness.js';

export const RACE_M = 21097.5;
export const RACE_KM = 21.0975;
/** Wie viel VDOT über dem aktuellen Stand das Renntempo im Training höchstens angesetzt wird. */
export const MAX_VDOT_STRETCH = 1.5;

const PHASE_LABEL = { basis: 'Basis', aufbau: 'Aufbau', spezifisch: 'Rennvorbereitung', taper: 'Tapering', rennwoche: 'Rennwoche' };
export const RACE_PHASE_LABEL = PHASE_LABEL;

/** @returns {null|object} null ohne Ziel (Zeit und Datum) oder nach dem Renntag */
export function raceInfo(settings, date, fit) {
  const g = settings?.goal;
  if (!g?.date || !g?.time_s) return null;
  const daysLeft = diffDays(g.date, date);
  if (daysLeft < 0) return null;
  const weeksLeft = diffDays(mondayOf(g.date), mondayOf(date)) / 7;
  const phase = weeksLeft === 0 ? 'rennwoche' : weeksLeft === 1 ? 'taper' : weeksLeft <= 5 ? 'spezifisch' : weeksLeft <= 11 ? 'aufbau' : 'basis';
  const goalPace = Math.round(g.time_s / RACE_KM);
  const requiredVdot = Math.round(vdotOf(RACE_M, g.time_s) * 10) / 10;
  const vdot = fit?.vdot ?? null;
  // Das Renntempo im Training bleibt in Reichweite des aktuellen Standes, damit das Ziel nicht überfordert
  const capPace = vdot == null ? goalPace : Math.round(predictTime(vdot + MAX_VDOT_STRETCH, RACE_M) / RACE_KM);
  const usedPace = Math.max(goalPace, capPace);
  return {
    date: g.date, time_s: g.time_s, daysLeft, weeksLeft, phase, label: PHASE_LABEL[phase],
    goalPace, usedPace, capped: usedPace > goalPace,
    requiredVdot, currentVdot: vdot, gap: vdot == null ? null : Math.round((requiredVdot - vdot) * 10) / 10,
  };
}

/** Struktur der Renntempo-Einheit für die Qualitätseinheit (null = normale Rotation). */
export function raceQuality(r, level) {
  if (!r) return null;
  const shrink = level === 'medium' ? 0.8 : 1;
  if (r.phase === 'rennwoche') return { type: 'strides', easyMin: 25, reps: 4, repS: 20 };
  if (r.phase === 'taper') return { type: 'racepace', reps: 2, repMin: Math.round(8 * shrink), recMin: 2, pace_s: r.usedPace };
  if (r.phase === 'spezifisch' && r.weeksLeft % 2 === 1) {
    const total = (20 + (5 - r.weeksLeft) * 4) * shrink; // 20 min in Woche 5, 28 min in Woche 3
    const reps = total <= 24 ? 2 : 3;
    return { type: 'racepace', reps, repMin: Math.round(total / reps), recMin: 2, pace_s: r.usedPace };
  }
  return null;
}

const fmtT = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Die Wettkampfeinheit am Renntag. */
export function racePlan(r, settings) {
  const warm = 12;
  const raceMin = Math.round(r.time_s / 60);
  return {
    title: `Halbmarathon, Ziel ${fmtT(r.time_s)}`,
    summary: `Renntag. Die ersten 5 km etwa ${Math.round(r.goalPace + 4)} s/km einrollen, danach gleichmäßig auf Zielpace, im Ziel noch etwas Reserve.`,
    steps: [
      { label: 'Einlaufen', detail: `${warm} min sehr locker, 3 kurze Steigerungen` },
      { label: 'Rennen', detail: `21,1 km bei ${Math.floor(r.goalPace / 60)}:${String(r.goalPace % 60).padStart(2, '0')} min/km, Ziel ${fmtT(r.time_s)}` },
    ],
    profile: [{ m: warm, k: 'easy', pace_s: r.goalPace + 60 }, { m: raceMin, k: 'mar', pace_s: r.goalPace }],
    targets: { distance_km: 21.1, duration_min: raceMin, pace_s: r.goalPace, time_s: r.time_s, hr_from: null, hr_to: settings.lthr },
    structure: { type: 'race' },
  };
}
