// Bewertung einer absolvierten Einheit gegen die Vorgabe und Folgen für die nächsten Einheiten.
// Regelbasiert und nachvollziehbar: jeder Teilwert liegt zwischen 0 und 1, die Gesamtnote ist ihr gewichteter Schnitt.
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const dec = (v, n = 1) => v.toFixed(n).replace('.', ',');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
/** 1 innerhalb der Toleranz `tol`, danach linear fallend auf 0 bei `zero`. */
const band = (dev, tol, zero) => clamp(1 - (Math.abs(dev) - tol) / (zero - tol));
const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const GROUP = (kind) => (String(kind).startsWith('run') ? 'running' : String(kind).startsWith('strength') ? 'strength' : 'cycling');

export const matchingActivities = (plan, activities, date) => {
  if (!plan || plan.kind === 'rest') return [];
  const g = GROUP(plan.kind);
  return activities.filter((a) => a.local_date === date && a.sport === g && (g !== 'running' || a.distance_m > 1500));
};

function verdict(score) {
  if (score >= 85) return 'Sehr gut umgesetzt';
  if (score >= 70) return 'Gut umgesetzt';
  if (score >= 55) return 'Teilweise umgesetzt';
  return 'Weicht deutlich ab';
}

/**
 * @param {{plan:object, activities:object[], history:object[], rd?:object|null, date:string}} o
 * @returns {null|{score:number, verdict:string, checks:object[], impact:string[]}}
 */
export function evaluateSession({ plan, activities, rd = null, date, act = null }) {
  const mine = matchingActivities(plan, activities, date);
  const main = mine.length ? mine.reduce((b, x) => ((x.duration_s || 0) > (b.duration_s || 0) ? x : b)) : null;
  const a = act || main;
  if (!a) return null;
  if (!main || main.id !== a.id) return evaluateFree({ plan, a, activities, rd, date });
  const t = plan.targets || {};
  const checks = [];
  const add = (key, label, w, score, note) => checks.push({ key, label, w, score: Math.round(score * 100) / 100, note });
  const impact = [];
  const g = GROUP(plan.kind);

  if (g === 'running') {
    const km = a.distance_m / 1000, pc = a.duration_s / km;
    const quality = plan.kind === 'run_quality' && !!plan.structure && !['strides', 'easy'].includes(plan.structure.type);
    const easy = !quality;
    let kmDev = 0;
    if (t.distance_km) { kmDev = km / t.distance_km - 1; add('dist', 'Distanz', 0.25, band(kmDev, 0.08, 0.35), `${dec(km)} von ${dec(t.distance_km)} km`); }
    if (t.pace_s && !quality) add('pace', 'Tempo', 0.2, band(pc - t.pace_s, 8, 40), `${mmss(pc)} statt ${mmss(t.pace_s)} /km`);
    let hrOver = 0;
    if (t.hr_to && a.avg_hr && !quality) { hrOver = a.avg_hr - t.hr_to; add('hr', 'Puls', 0.25, hrOver > 2 ? band(hrOver, 2, 14) : a.avg_hr < (t.hr_from || 0) - 8 ? band((t.hr_from - 8) - a.avg_hr, 0, 12) : 1, `Ø ${Math.round(a.avg_hr)} bpm, Ziel bis ${t.hr_to}`); }
    const zs = a.zone_s || [], zt = zs.reduce((x, y) => x + y, 0);
    if (zt > 300) {
      if (quality) { const hard = (zs[3] + zs[4]) / zt; add('zone', 'Intensität', 0.3, clamp(hard / 0.15), `${Math.round(hard * 100)} % der Zeit in Z4 und Z5`); }
      else { const lo = (zs[0] + zs[1]) / zt; add('zone', 'Zonen', 0.2, clamp((lo - 0.4) / 0.4), `${Math.round(lo * 100)} % in Z1 und Z2`); }
    }
    const sp = (a.km_splits || a.splits || []).filter((s) => s.pace_s);
    if (sp.length >= 4 && !quality) {
      const h = Math.floor(sp.length / 2), m1 = sp.slice(0, h).reduce((s, x) => s + x.pace_s, 0) / h, m2 = sp.slice(-h).reduce((s, x) => s + x.pace_s, 0) / h;
      const fade = m2 / m1 - 1; // positiv = hinten langsamer
      add('even', 'Gleichmäßigkeit', 0.1, fade > 0 ? band(fade, 0.03, 0.1) : 1, fade > 0.03 ? `hinten ${Math.round(fade * 100)} % langsamer` : 'gleichmäßig eingeteilt');
    }
    // Auswirkungen
    if (easy && hrOver > 5) impact.push(`Der Lauf war für eine lockere Einheit zu intensiv (Puls ${Math.round(hrOver)} bpm über Ziel). Das kostet Erholung für den nächsten harten Lauf. Beim nächsten Mal Tempo drosseln und auf den Zielpuls achten.`);
    else if (quality && checks.find((c) => c.key === 'zone')?.score >= 0.8) impact.push('Der Qualitätsreiz ist gesetzt. Bei guter Erholung geht der Plan mit der nächsten harten Einheit wie vorgesehen weiter, danach folgen ein bis zwei lockere Tage.');
    else if (quality) impact.push('Der Qualitätsreiz fiel schwächer aus als geplant. Das ist kein Problem für die Erholung, der Trainingseffekt dieser Einheit ist aber geringer.');
    if (kmDev < -0.15) impact.push(`${dec(t.distance_km - km)} km weniger als geplant. Der Planer holt das nicht nach, das Wochenziel sinkt entsprechend.`);
    else if (kmDev > 0.15) impact.push(`${dec(km - t.distance_km)} km mehr als geplant. Die Wochenbelastung steigt entsprechend.`);
    if (a.te_aerobic >= 4) impact.push(`Garmin wertet den aeroben Trainingseffekt mit ${dec(a.te_aerobic)} als hoch. Rechne mit etwa 48 Stunden, bis du wieder frisch bist.`);
    if (a.load) {
      const med = median(activities.filter((x) => x.sport === 'running' && x.local_date < date && x.local_date >= shiftDate(date, -42) && x.load).map((x) => x.load));
      if (med && a.load > med * 1.3) impact.push(`Die Belastung liegt ${Math.round((a.load / med - 1) * 100)} % über deinem üblichen Lauf der letzten Wochen.`);
    }
  } else {
    if (t.duration_min) add('dur', 'Dauer', 0.6, band(a.duration_s / 60 / t.duration_min - 1, 0.1, 0.5), `${Math.round(a.duration_s / 60)} von ${t.duration_min} min`);
    if (a.te_aerobic != null) add('te', 'Trainingseffekt', 0.4, clamp(a.te_aerobic / 2.5), `Garmin ${dec(a.te_aerobic)}`);
    if (g === 'strength') impact.push('Kraft belastet vor allem Beine und Rumpf. Vor dem nächsten harten Lauf sollten mindestens 24 Stunden dazwischen liegen.');
    else impact.push('Spinning zählt als aerobe Grundlage und belastet die Beine wenig. Es passt gut zwischen die Laufeinheiten.');
  }
  if (rd?.acwr != null) {
    if (rd.acwr > 1.3) impact.push(`Deine Wochenlast ist jetzt hoch (ACWR ${dec(rd.acwr, 2)}). Die nächsten Einheiten werden bei Bedarf entschärft.`);
    else if (rd.acwr < 0.8) impact.push(`Deine Wochenlast ist niedrig (ACWR ${dec(rd.acwr, 2)}). Es ist Platz für etwas mehr Umfang.`);
  }
  const wsum = checks.reduce((s, c) => s + c.w, 0);
  const score = wsum ? Math.round((checks.reduce((s, c) => s + c.w * c.score, 0) / wsum) * 100) : null;
  return { activity_id: a.id, score, verdict: score == null ? 'Absolviert' : verdict(score), checks: checks.map(({ w, ...c }) => c), impact: impact.slice(0, 4) };
}


/** Einheit ohne passende Vorgabe (Ruhetag, andere Sportart, zweite Einheit): Einordnung statt Note. */
function evaluateFree({ plan, a, activities, rd, date }) {
  const impact = [];
  const rest = !plan || plan.kind === 'rest';
  const why = rest ? 'Ruhetag' : 'abweichend vom Plan';
  let verdict;
  let hard = 0;
  if (a.sport === 'running') {
    const zs = a.zone_s || [], zt = zs.reduce((x, y) => x + y, 0);
    const lo = zt ? (zs[0] + zs[1]) / zt : null; hard = zt ? (zs[3] + zs[4]) / zt : 0;
    verdict = lo == null ? 'Zusätzlicher Lauf' : hard >= 0.25 ? 'Harter Lauf' : lo >= 0.75 ? 'Lockerer Lauf' : 'Mittelschwerer Lauf';
    if (hard >= 0.25) impact.push('Eine harte Einheit außerhalb des Plans. Bis zur nächsten harten Einheit sollten mindestens 48 Stunden liegen. Der Planer berücksichtigt die Belastung und entschärft die nächsten Einheiten bei Bedarf.');
    else if (lo != null && lo >= 0.75) impact.push('Ein lockerer Zusatzlauf kostet wenig Erholung, erhöht aber deinen Wochenumfang.');
    else impact.push('Ein Lauf im mittleren Bereich: zu locker für einen Reiz, zu hart für echte Erholung. Als Zusatz ist das in Ordnung, ersetzt aber keine geplante Einheit.');
  } else if (a.sport === 'strength') { verdict = 'Zusätzliches Krafttraining'; impact.push('Kraft belastet Beine und Rumpf. Vor dem nächsten harten Lauf sollten mindestens 24 Stunden liegen.'); }
  else if (a.sport === 'cycling') { verdict = 'Zusätzliches Radfahren'; impact.push('Radfahren zählt als aerobe Grundlage und belastet die Beine wenig.'); }
  else { verdict = 'Zusätzliche Aktivität'; }
  verdict += ` · ${why}`;
  if (rest && a.duration_s > 1200) impact.push('Das war ein Ruhetag. Wiederholt sich das, fehlt die Erholung. Achte morgen früh auf HRV und Ruhepuls.');
  if (a.te_aerobic >= 4) impact.push(`Garmin wertet den aeroben Trainingseffekt mit ${dec(a.te_aerobic)} als hoch. Rechne mit etwa 48 Stunden, bis du wieder frisch bist.`);
  if (a.load && a.sport === 'running') {
    const med = median(activities.filter((x) => x.sport === 'running' && x.local_date < date && x.local_date >= shiftDate(date, -42) && x.load).map((x) => x.load));
    if (med && a.load > med * 1.3) impact.push(`Die Belastung liegt ${Math.round((a.load / med - 1) * 100)} % über deinem üblichen Lauf der letzten Wochen.`);
  }
  if (rd?.acwr != null && rd.acwr > 1.3) impact.push(`Deine Wochenlast ist jetzt hoch (ACWR ${dec(rd.acwr, 2)}). Die nächsten Einheiten werden bei Bedarf entschärft.`);
  return { activity_id: a.id, free: true, score: null, verdict, checks: [], impact: impact.slice(0, 4) };
}

function shiftDate(date, n) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
