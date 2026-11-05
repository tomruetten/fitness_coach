// Energiebedarf: Ruheumsatz + Alltag (Schritte) + Training (je Sportart passende Methode) + Thermischer Effekt.
// Quellen: ten Haaf & Weijs 2014 (RMR Sportler), Mifflin-St Jeor 1990 (Vergleich), ACSM-Laufgleichung (netto ca. 1 kcal/kg/km),
// Radarbeit in kJ ≈ kcal bei ca. 24 % Wirkungsgrad, Keytel 2005 (Puls-Schätzung), MET-Tabelle (Kraft),
// Makros nach ISSN/IOC/ACSM für Ausdauersport.
const r0 = (v) => Math.round(v);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const DEFAULT_BODY = { height_cm: 188, weight_kg: 79, age: 25 };
export const bodyOf = (settings = {}) => ({ ...DEFAULT_BODY, ...(settings.body || {}) });

/** Ruheumsatz in kcal/Tag (Männer). */
export const rmrTenHaaf = ({ weight_kg: w, height_cm: h, age: a }) => 11.936 * w + 587.728 * (h / 100) - 8.129 * a + 191.027 + 29.279;
export const rmrMifflin = ({ weight_kg: w, height_cm: h, age: a }) => 10 * w + 6.25 * h - 5 * a + 5;

const SLEEP_NEAT = 1.1;   // Sitzen, Stehen, Kleinbewegung zusätzlich zum Ruheumsatz
const TEF = 1.08;         // thermischer Effekt der Nahrung (ca. 8 % des Gesamtumsatzes)
const KCAL_PER_STEP_PER_KG = 0.000375; // netto Gehen: ca. 0,5 kcal/kg/km bei 0,75 m Schrittlänge
const DEFICIT = 250;      // kcal unter dem Bedarf bei Ziel „Fett abbauen“
const EPOC = 1.05;        // Nachbrenneffekt, pauschal
const STRENGTH_MET = 4.0;
const SPIN_MET = 8.5;

const netPerMin = (met, kg) => ((met - 1) * 3.5 * kg) / 200;

/** Netto-Kalorien einer gelaufenen oder geplanten Einheit (ohne den ohnehin verbrauchten Ruheumsatz). */
export function sessionKcal(a, body) {
  const kg = body.weight_kg, rmrMin = rmrTenHaaf(body) / 1440;
  const min = (a.duration_s || 0) / 60;
  switch (a.sport) {
    case 'running': return (a.distance_m / 1000) * kg * 1.0 + (a.ascent_m || 0) * kg * 0.0063;
    case 'cycling': {
      if (a.avg_power > 0) return Math.max(0, (a.avg_power * (a.duration_s || 0)) / 1000 - rmrMin * min); // kJ ≈ kcal
      if (a.avg_hr > 90) return Math.max(0, (-55.0969 + 0.6309 * a.avg_hr + 0.1988 * kg + 0.2017 * body.age) / 4.184 * min - rmrMin * min);
      return netPerMin(SPIN_MET, kg) * min;
    }
    case 'strength': return netPerMin(STRENGTH_MET, kg) * min;
    default:
      if (a.avg_hr > 90) return Math.max(0, (-55.0969 + 0.6309 * a.avg_hr + 0.1988 * kg + 0.2017 * body.age) / 4.184 * min - rmrMin * min);
      return netPerMin(5, kg) * min;
  }
}

/** Geplante Einheit grob in kcal (netto). */
export function plannedKcal(plan, body, session = null) {
  const kind = String(plan?.kind || 'rest');
  const kg = body.weight_kg;
  if (kind.startsWith('run')) {
    const km = Number(plan.targets?.distance_km) || 0;
    return km * kg * 1.0;
  }
  if (kind === 'spinning') return netPerMin(SPIN_MET, kg) * 60;
  if (kind.startsWith('strength')) return netPerMin(STRENGTH_MET, kg) * (Number(session?.duration_min || plan.targets?.duration_min) || 60);
  return 0;
}

/** Typische Alltagsschritte ohne Laufschritte (Median der letzten 14 Tage). */
export function baseSteps(days, activities, date, fallback = 6500) {
  const vals = [];
  for (const d of days || []) {
    if (!(d.date < date) || !(d.steps > 1500)) continue;
    const runM = (activities || []).filter((a) => a.local_date === d.date && a.sport === 'running').reduce((s, a) => s + (a.distance_m || 0), 0);
    vals.push(Math.max(0, d.steps - runM / 1.1));
  }
  return vals.length >= 3 ? median(vals.slice(-14)) : fallback;
}

/** Makros nach Tagestyp: Protein 1,8 g/kg, Fett 1,0 g/kg, Rest Kohlenhydrate. */
export function macros(kcal, kg, proteinPerKg = 1.8) {
  const protein = proteinPerKg * kg, fat = 1.0 * kg;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
  return { protein_g: r0(protein), fat_g: r0(fat), carbs_g: r0(carbs), carbs_per_kg: Math.round((carbs / kg) * 10) / 10 };
}

/**
 * Tagesbedarf. activities: Aktivitäten des Tages; plan: Plan des Tages; loggedKg: Tagesvolumen aus dem Kraftlog.
 * Hat der Tag Aktivitäten, zählen sie (Quelle „ist“), sonst die Planung („plan“).
 */
export function dayEnergy({ settings, date, plan, session = null, activities = [], days = [], allActivities = [], strengthSets = 0, nextPlan = null, trend = null }) {
  const body = bodyOf(settings);
  const rmr = rmrTenHaaf(body);
  const mifflin = rmrMifflin(body);
  const acts = activities.filter((a) => a.local_date === date);
  const parts = [];
  let source = 'plan';
  let exercise = 0;
  if (acts.length) {
    source = 'ist';
    for (const a of acts) { const k = sessionKcal(a, body); exercise += k; parts.push({ sport: a.sport, kcal: r0(k) }); }
    if (strengthSets && !acts.some((a) => a.sport === 'strength')) {
      const min = Math.max(20, Math.min(90, strengthSets * 3));
      const k = netPerMin(STRENGTH_MET, body.weight_kg) * min; exercise += k; parts.push({ sport: 'strength', kcal: r0(k) });
    }
  } else if (strengthSets) {
    source = 'ist';
    const min = Math.max(20, Math.min(90, strengthSets * 3));
    exercise = netPerMin(STRENGTH_MET, body.weight_kg) * min; parts.push({ sport: 'strength', kcal: r0(exercise) });
  } else {
    exercise = plannedKcal(plan, body, session);
    if (exercise) parts.push({ sport: String(plan?.kind || '').startsWith('run') ? 'running' : plan?.kind === 'spinning' ? 'cycling' : 'strength', kcal: r0(exercise) });
  }
  exercise *= EPOC;
  const steps = baseSteps(days, allActivities, date);
  const walk = steps * KCAL_PER_STEP_PER_KG * body.weight_kg;
  const calc = (r) => (r * SLEEP_NEAT + walk + exercise) * TEF;
  const need = calc(rmr), low = calc(mifflin);
  // Ernährungsziel: „recomp“ (Fett abbauen, Muskeln aufbauen) = moderates Defizit, aber nicht am langen Lauf, am Tag davor
  // und nicht, wenn das Gewicht ohnehin schon zu schnell fällt
  const goal = settings?.nutrition === 'halten' ? 'halten' : 'recomp';
  let deficit = goal === 'recomp' ? DEFICIT : 0, deficitNote = null;
  if (goal === 'recomp') {
    if (String(plan?.kind) === 'run_long') { deficit = 0; deficitNote = 'Langer Lauf: heute ohne Defizit, damit die Einheit und die Erholung stimmen.'; }
    else if (String(nextPlan?.kind) === 'run_long') { deficit = 0; deficitNote = 'Morgen langer Lauf: heute ohne Defizit, die Speicher sollen voll sein.'; }
    else if (trend != null && trend < -0.5) { deficit = 0; deficitNote = 'Gewicht fällt schneller als 0,5 kg pro Woche: kein Defizit, sonst leidet der Muskelaufbau.'; }
  }
  const total = need - deficit;
  const m = macros(total, body.weight_kg, goal === 'recomp' ? 2.0 : 1.8);
  let tip = null;
  if (String(nextPlan?.kind || '') === 'run_long') tip = 'Morgen langer Lauf: heute lieber reichlich Kohlenhydrate (Reis, Nudeln, Kartoffeln).';
  else if (String(plan?.kind || '').startsWith('run') || plan?.kind === 'spinning') tip = 'Trainingstag: Kohlenhydrate vor und nach der Einheit, Eiweiß über den Tag verteilen.';
  return {
    kcal: r0(total), need: r0(need), deficit: r0(deficit), goal, deficit_note: deficitNote, low: r0(Math.min(need * 0.92, low) - deficit), high: r0(need * 1.08 - deficit),
    rmr: r0(rmr), rmr_mifflin: r0(mifflin), daily: r0(rmr * SLEEP_NEAT * TEF), walk: r0(walk * TEF), steps: r0(steps),
    exercise: r0(exercise * TEF), parts, source, ...m, tip,
    method: 'ten Haaf (Sportler-RMR), Schritte, Lauf nach Distanz, Rad nach Watt oder Puls, Kraft nach MET',
  };
}

/** Gewichtstrend in kg pro Woche aus Einträgen der letzten 28 Tage (lineare Regression, mind. 3 Einträge über 10 Tage). */
export function weightTrend(log, today) {
  const pts = (log || []).filter((e) => e.date <= today && (new Date(today) - new Date(e.date)) / 864e5 <= 28).map((e) => ({ x: (new Date(e.date) - new Date(today)) / 864e5, y: e.kg }));
  if (pts.length < 3) return null;
  const span = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  if (span < 10) return null;
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const slope = sxx ? (sxy / sxx) * 7 : 0;
  return Math.round(slope * 100) / 100;
}

/** Empfehlung aus dem Gewichtstrend (bei Ziel „Gewicht halten“). 1 kg ≈ 7000 kcal. */
export function trendAdvice(slope) {
  if (slope == null) return null;
  const adj = Math.round((-slope * 7000) / 7 / 50) * 50;
  if (Math.abs(slope) < 0.15) return { text: 'Gewicht stabil: die Schätzung passt.', adjust: 0 };
  return { text: slope < 0 ? `Gewicht sinkt um ${Math.abs(slope).toFixed(2).replace('.', ',')} kg pro Woche: etwa ${adj} kcal mehr essen.` : `Gewicht steigt um ${slope.toFixed(2).replace('.', ',')} kg pro Woche: etwa ${Math.abs(adj)} kcal weniger essen.`, adjust: adj };
}

/** Kalorien aus den Garmin-Tageswerten, soweit die Antwort sie enthält (Feldnamen variieren). */
export function kcalFrom(summaries) {
  const num = (v) => (typeof v === 'number' ? v : typeof v?.value === 'number' ? v.value : null);
  const out = {};
  for (const s of summaries || []) {
    if (!s?.calendarDate) continue;
    const active = num(s.activeKilocalories) ?? num(s.calories?.active) ?? num(s.calories?.activeKilocalories) ?? num(s.movement?.activeKilocalories) ?? num(s.movement?.calories?.active);
    const bmr = num(s.bmrKilocalories) ?? num(s.calories?.bmr) ?? num(s.calories?.bmrKilocalories) ?? num(s.movement?.bmrKilocalories);
    const total = num(s.totalKilocalories) ?? num(s.calories?.total) ?? num(s.calories?.totalKilocalories) ?? (active != null && bmr != null ? active + bmr : null);
    if (total != null || active != null) out[s.calendarDate] = { total, active, bmr };
  }
  return out;
}
