// Planengine: berechnet jede Einheit aus festen, nachvollziehbaren Regeln.
// Eingabe sind Einstellungen, Aktivitäten, Tageswerte und Kraft-Log. Ausgabe ist die Einheit samt Begründung.
import { DEFAULT_SETTINGS, RULES } from './config.js';
import { addDays, diffDays, mondayOf, weekday, weekDates, WEEKDAYS } from './dates.js';
import { blockFor, BLOCK_LABEL } from './blocks.js';
import { acuteChronic } from './load.js';
import { recoveryState } from './recovery.js';
import { zoneBounds } from './zones.js';
import { longRunKm, runEasy, runLong, runQuality, strengthSession } from './sessions.js';

export function withDefaults(settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings, goal: { ...DEFAULT_SETTINGS.goal, ...(settings.goal || {}) }, week: { ...DEFAULT_SETTINGS.week, ...(settings.week || {}) } };
  const [b2, b3, b4] = zoneBounds(s.lthr);
  s._z2from = b2;
  s._z2to = b3 - 1;
  s._z4from = b4;
  return s;
}

/** Einheit eines Tages: eigene Verschiebung (settings._ov) oder feste Wochenstruktur. */
export function slotOf(settings, d) {
  const k = settings._ov?.[d];
  if (k) return Object.values(settings.week).find((s) => s.kind === k) || { kind: 'rest', label: 'Ruhe' };
  return settings.week[weekday(d)] || { kind: 'rest', label: 'Ruhe' };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Laufkilometer je Woche (Schlüssel = Montag). */
export function weeklyRunKm(activities) {
  const out = {};
  for (const a of activities) {
    if (a.sport !== 'running' || !a.distance_m || a.distance_m < 1500) continue;
    const w = mondayOf(a.local_date);
    out[w] = (out[w] || 0) + a.distance_m / 1000;
  }
  return out;
}

function avgRunKmLast3(activities, date) {
  const w = weeklyRunKm(activities);
  const m = mondayOf(date);
  const vals = [1, 2, 3].map((i) => w[addDays(m, -7 * i)] || 0);
  return sum(vals) / 3;
}

/** Läufe an geplanten Lauftagen der letzten 14 Tage ohne Aktivität (Verschiebung um 1 Tag erlaubt). */
export function missedRuns(settings, activities, date) {
  const runDates = new Set(activities.filter((a) => a.sport === 'running' && a.distance_m > 1500).map((a) => a.local_date));
  const firstAct = activities.length ? activities.map((a) => a.local_date).sort()[0] : date;
  const missed = [];
  for (let i = 1; i <= 14; i++) {
    const d = addDays(date, -i);
    if (d < firstAct) break;
    const kind = slotOf(settings, d).kind;
    if (kind !== 'run_quality' && kind !== 'run_long') continue;
    if (!runDates.has(d) && !runDates.has(addDays(d, 1)) && !runDates.has(addDays(d, -1))) missed.push(d);
  }
  return missed.sort();
}

function lastLogsByExercise(strengthLog) {
  const out = {};
  for (const l of [...(strengthLog || [])].sort((a, b) => a.date.localeCompare(b.date))) out[l.exercise_id] = l;
  return out;
}

/** Readiness-Zusammenfassung für das Dashboard und die Regeln. */
export function readiness(ctx) {
  const settings = withDefaults(ctx.settings);
  const date = ctx.date;
  const rec = recoveryState(ctx.days || [], date);
  const ac = acuteChronic(ctx.activities || [], date);
  const signals = [...rec.signals];
  if (ac.ratio != null && ac.ratio > RULES.acwrHigh) {
    signals.push({ id: 'R-LOAD', text: `Belastung der letzten 7 Tage ist ${ac.ratio.toFixed(2)}-mal so hoch wie dein Schnitt` });
  }
  const recent = (ctx.activities || []).filter((a) => a.sport === 'running' && diffDays(date, a.local_date) >= 0 && diffDays(date, a.local_date) <= 2 && a.rpe != null);
  const hard = recent.find((a) => a.rpe >= RULES.rpeHigh);
  if (hard) signals.push({ id: 'R-RPE', text: `Letzter Lauf am ${hard.local_date} mit Anstrengung ${hard.rpe} von 10` });
  const pain = (ctx.pain || []).find((p) => diffDays(date, p.date) >= 0 && diffDays(date, p.date) <= 7 && p.level >= RULES.painThreshold);
  if (pain) signals.push({ id: 'R-PAIN', text: `Schmerz ${pain.level} von 10 gemeldet am ${pain.date}${pain.area ? ` (${pain.area})` : ''}` });
  const level = signals.length >= 2 ? 'low' : signals.length === 1 ? 'medium' : 'good';
  return { level, signals, acwr: ac.ratio, acute: ac.acute, chronicWeekly: ac.chronicWeekly, hrv: { now: rec.hrvNow, mean: rec.hrvMean, sd: rec.hrvSd }, rhr: { now: rec.rhrNow, base: rec.rhrBase }, settings };
}

/**
 * Plant einen Tag.
 * @param {object} ctx  {date, settings, activities, days, strengthLog, pain}
 * @param {{provisional?:boolean, rd?:object}} opts  provisional: Zukunftstage ohne Erholungsregeln
 */
export function planDay(ctx, opts = {}) {
  const settings = withDefaults(ctx.settings);
  const date = ctx.date;
  const acts = ctx.activities || [];
  const block = blockFor(date, settings);
  const wd = weekday(date);
  const slot = slotOf(settings, date);
  const why = [];
  const rd = opts.provisional ? { level: 'good', signals: [], acwr: null } : opts.rd || readiness({ ...ctx, settings });
  const level = rd.level;
  const base = { date, weekday: WEEKDAYS[wd], kind: slot.kind, label: slot.label, fixed: !!slot.fixed, block: { name: block.name, label: BLOCK_LABEL[block.name], week: block.week, deload: block.deload }, provisional: !!opts.provisional, moved: !!settings._ov?.[date] && settings._ov[date] !== (settings.week[wd]?.kind || 'rest') };

  if (block.deload) why.push({ rule: 'R-DELOAD', text: `Entlastungswoche im ${BLOCK_LABEL[block.name]}-Block: Umfang etwa 20 % niedriger` });
  const loadHigh = rd.signals?.some((s) => s.id === 'R-LOAD');
  const scaleWeek = block.deload ? 0.8 : loadHigh ? 0.85 : 1;
  if (loadHigh) why.push({ rule: 'R-LOAD', text: rd.signals.find((s) => s.id === 'R-LOAD').text + ': diese Woche entlastet' });

  if (slot.kind === 'rest') {
    return { ...base, title: 'Ruhetag', summary: 'Erholung ist Teil des Trainings. Spaziergang oder Mobilität sind in Ordnung.', steps: [], why, targets: {} };
  }

  if (slot.kind === 'spinning') {
    const tips = [];
    if (!opts.provisional && level === 'low') tips.push('Erholung niedrig: Intervalle bei Bedarf eine Stufe leichter fahren.');
    return { ...base, title: 'Spinning: Intervalle', summary: 'Fester Kurs, 1 h Intervalltraining. Wird nicht von der App geplant, aber als harte Einheit in die Belastung eingerechnet.', steps: tips.map((t) => ({ label: 'Hinweis', detail: t })), why, targets: { duration_min: 60 } };
  }

  if (slot.kind === 'run_quality') {
    const missed = opts.provisional ? [] : missedRuns(settings, acts, date);
    let step = false;
    let easyInstead = false;
    if (!opts.provisional) {
      const medium = rd.signals.filter((s) => s.id !== 'R-LOAD');
      if (level === 'medium' && medium.length) { step = true; why.push({ rule: medium[0].id, text: medium[0].text + ': Lauf eine Stufe leichter' }); }
      if (level === 'low') { easyInstead = true; for (const s of rd.signals.slice(0, 2)) why.push({ rule: s.id, text: s.text }); why.push({ rule: 'R-EASY', text: 'Mehrere Erholungssignale: statt Qualität ein lockerer Lauf' }); }
      if (missed.length >= 2) { why.push({ rule: 'R-MISSED', text: `Zwei geplante Läufe ausgefallen (${missed.slice(-2).join(', ')}): Block eine Stufe zurück` }); }
    }
    const effBlock = !opts.provisional && missed.length >= 2 ? { ...block, week: Math.max(1, block.week - 1) } : block;
    if (easyInstead) {
      const s = runEasy(Math.round(40 * scaleWeek), settings, 'Lockerer Lauf statt Qualität');
      return { ...base, ...s, why, adjusted: true };
    }
    const q = runQuality(effBlock, settings, { step });
    return { ...base, ...q, why, adjusted: step || (missed.length >= 2) };
  }

  if (slot.kind === 'run_long') {
    const planned = longRunKm(block);
    const q = runQuality(block, settings);
    const quality = q.targets.distance_km;
    let km = planned * scaleWeek;
    // Wachstumsregel: Wochenumfang höchstens +10 % gegen den Schnitt der letzten 3 Wochen.
    const avg3 = Math.max(avgRunKmLast3(acts, date), 10);
    const cap = avg3 * (1 + RULES.weeklyKmGrowth) - quality;
    let capped = false;
    if (!opts.provisional && km > cap) { km = Math.max(8, cap); capped = true; why.push({ rule: 'R-GROWTH', text: `Wochenumfang auf +10 % gegen deinen Schnitt von ${avg3.toFixed(0)} km begrenzt: Lauf ${Math.round(km)} statt ${planned} km` }); }
    let scale = 1;
    if (!opts.provisional && level === 'medium') { scale = 0.85; const s = rd.signals.find((x) => x.id !== 'R-LOAD') || rd.signals[0]; if (s) why.push({ rule: s.id, text: s.text + ': langer Lauf um etwa 15 % kürzer, ohne Zieltempo-Teil' }); }
    if (!opts.provisional && level === 'low') { scale = 0.7; for (const s of rd.signals.slice(0, 2)) why.push({ rule: s.id, text: s.text }); why.push({ rule: 'R-EASY', text: 'Mehrere Erholungssignale: langer Lauf um 30 % kürzer' }); }
    const s = runLong(block, settings, { km, scale });
    return { ...base, ...s, why, adjusted: capped || scale < 1 };
  }

  if (slot.kind === 'strength_a' || slot.kind === 'strength_b') {
    // Spinning-Belastung der letzten 36 Stunden und Schmerz-Hinweis
    let levelS = 'full';
    let legLight = false;
    if (!opts.provisional) {
      if (level === 'medium') levelS = 'reduced';
      if (level === 'low') levelS = 'light';
      const spin = acts.filter((a) => a.sport === 'cycling' && a.indoor && diffDays(date, a.local_date) === 1);
      if (spin.length && slot.kind === 'strength_a') {
        const spinHist = acts.filter((a) => a.sport === 'cycling' && a.indoor && diffDays(date, a.local_date) > 1 && diffDays(date, a.local_date) <= 29);
        const avg = spinHist.length ? sum(spinHist.map((a) => a.load || 0)) / spinHist.length : null;
        const l = sum(spin.map((a) => a.load || 0));
        if (avg != null && l > avg * 1.3) { legLight = true; why.push({ rule: 'R-SPIN', text: `Spinning gestern war mit Belastung ${Math.round(l)} fordernder als dein Schnitt (${Math.round(avg)}): Beinübungen heute leicht` }); }
      }
      if (levelS !== 'full' && rd.signals.length) for (const s of rd.signals.filter((x) => x.id !== 'R-LOAD').slice(0, 2)) why.push({ rule: s.id, text: s.text + ': weniger Sätze' });
      if (loadHigh) { levelS = levelS === 'full' ? 'reduced' : levelS; }
      const pain = (ctx.pain || []).find((p) => diffDays(date, p.date) >= 0 && diffDays(date, p.date) <= 14 && p.level >= RULES.painThreshold && p.area);
      if (pain) why.push({ rule: 'R-PAIN', text: `Schmerz im Bereich „${pain.area}“ gemeldet: belastende Übungen weglassen oder ersetzen` });
    }
    if (block.deload) levelS = levelS === 'full' ? 'reduced' : levelS;
    const s = strengthSession(slot.kind, { block, level: levelS, lastLogs: lastLogsByExercise(ctx.strengthLog), legLight, maxMin: settings.strength_max_min });
    return { ...base, ...s, why, adjusted: levelS !== 'full' || legLight };
  }
  return { ...base, title: slot.label, summary: '', steps: [], why, targets: {} };
}

/** Plan für die Woche (Montag bis Sonntag). Vergangene Tage und heute mit Regeln, spätere vorläufig. */
export function planWeek(ctx) {
  const days = weekDates(ctx.date);
  const today = ctx.today || ctx.date;
  const rdToday = readiness({ ...ctx, date: today });
  return days.map((d) => {
    const provisional = diffDays(d, today) > 0;
    const dctx = { ...ctx, date: d };
    return planDay(dctx, { provisional, rd: provisional ? undefined : readiness({ ...ctx, date: d < today ? d : today }) });
  });
}
