// Planengine: berechnet jede Einheit aus festen, nachvollziehbaren Regeln.
// Eingabe sind Einstellungen, Aktivitäten, Tageswerte und Kraft-Log. Ausgabe ist die Einheit samt Begründung.
import { DEFAULT_SETTINGS, RULES } from './config.js';
import { addDays, diffDays, mondayOf, weekday, weekDates, WEEKDAYS } from './dates.js';
import { loadModel } from './load.js';
import { recoveryState } from './recovery.js';
import { zoneBounds, fmtPace } from './zones.js';
import { buildQuality, runEasy, runLong, strengthSession } from './sessions.js';
import { fitnessState } from './fitness.js';
import { planLong, planQuality, weeklyPlan } from './progression.js';

export const BLOCK_LABEL = { basis: 'Basis', aufbau: 'Aufbau' };

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
    const manual = settings._status?.[d];
    if (manual === 'done') continue;
    if (manual === 'skipped') { missed.push(d); continue; }
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
const clampN = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Transparenter Erholungswert 0–100: Abzüge für HRV, Ruhepuls, Schlaf, Belastung, Anstrengung und Schmerz. */
function recoveryScore({ rec, days, date, acwr, hardRpe, pain, unfit }) {
  const latest = (k) => [...days].filter((d) => d.date <= date && Number.isFinite(d[k]) && diffDays(date, d.date) <= 3).sort((a, b) => b.date.localeCompare(a.date))[0];
  const parts = [];
  let pen = 0, any = false;
  const st = (v, good, mid) => (v <= good ? 'good' : v <= mid ? 'medium' : 'low');
  if (rec.hrvNow != null && rec.hrvMean != null && rec.hrvSd) {
    const z = Math.log(rec.hrvNow / rec.hrvMean) / (rec.hrvSd / rec.hrvMean);
    pen += clampN(-z, 0, 3) * 8; any = true;
    parts.push({ key: 'hrv', label: 'HRV', value: `${Math.round(latest('hrv_avg')?.hrv_avg ?? rec.hrvNow)} ms`, status: st(-z, 0.5, 1) });
  }
  if (rec.rhrNow != null && rec.rhrBase != null) {
    const dlt = rec.rhrNow - rec.rhrBase;
    pen += clampN(dlt, 0, 10) * 2; any = true;
    parts.push({ key: 'rhr', label: 'Ruhepuls', value: `${Math.round(latest('resting_hr')?.resting_hr ?? rec.rhrNow)} bpm`, status: st(dlt, 2, 5) });
  }
  const sl = latest('sleep_s');
  if (sl && sl.sleep_s > 0) {
    const h = sl.sleep_s / 3600;
    pen += clampN(7.5 - h, 0, 3) * 7; any = true;
    parts.push({ key: 'sleep', label: 'Schlaf', value: `${h.toFixed(1).replace('.', ',')} h`, status: h >= 7 ? 'good' : h >= 6.5 ? 'medium' : 'low' });
  }
  if (acwr != null) {
    pen += clampN((acwr - 1.3) * 40, 0, 20); any = true;
    parts.push({ key: 'load', label: 'Belastung', value: acwr.toFixed(2).replace('.', ','), status: acwr <= 1.3 ? 'good' : acwr <= 1.5 ? 'medium' : 'low' });
  }
  if (hardRpe) pen += 8;
  if (unfit) { pen += 25; any = true; }
  if (pain) pen += Math.min(15, pain.level * 2);
  return { score: any ? Math.round(clampN(100 - pen, 0, 100)) : null, parts };
}

export function readiness(ctx) {
  const settings = withDefaults(ctx.settings);
  const date = ctx.date;
  const rec = recoveryState(ctx.days || [], date);
  const ac = loadModel(ctx.activities || [], date);
  const signals = [...rec.signals];
  if (ac.ratio != null && ac.ratio > RULES.acwrHigh) {
    signals.push({ id: 'R-LOAD', text: `Belastung der letzten 7 Tage ist ${ac.ratio.toFixed(2)}-mal so hoch wie dein Schnitt` });
  }
  const recent = (ctx.activities || []).filter((a) => a.sport === 'running' && diffDays(date, a.local_date) >= 0 && diffDays(date, a.local_date) <= 2 && a.rpe != null);
  const hard = recent.find((a) => a.rpe >= RULES.rpeHigh);
  if (hard) signals.push({ id: 'R-RPE', text: `Letzter Lauf am ${hard.local_date} mit Anstrengung ${hard.rpe} von 10` });
  const pain = (ctx.pain || []).find((p) => diffDays(date, p.date) >= 0 && diffDays(date, p.date) <= 7 && p.level >= RULES.painThreshold);
  if (pain) signals.push({ id: 'R-PAIN', text: `Schmerz ${pain.level} von 10 gemeldet am ${pain.date}${pain.area ? ` (${pain.area})` : ''}` });
  const unfit = !!ctx.settings?._unfit?.[date];
  if (unfit) signals.push({ id: 'R-SELF', text: 'Du hast dich heute als nicht fit gemeldet' });
  const level = unfit || signals.length >= 2 ? 'low' : signals.length === 1 ? 'medium' : 'good';
  const rs = recoveryScore({ rec, days: ctx.days || [], date, acwr: ac.ratio, hardRpe: !!hard, pain, unfit });
  return { level, score: rs.score, parts: rs.parts, signals, acwr: ac.ratio, acute: ac.acute * 7, chronicWeekly: ac.chronic * 7, form: ac.form, monotony: ac.monotony, hrv: { now: rec.hrvNow, mean: rec.hrvMean, sd: rec.hrvSd }, rhr: { now: rec.rhrNow, base: rec.rhrBase }, settings };
}

/** Alles, was für die Läufe einer Woche gleich bleibt: Leistungsstand und Wochenumfang/Zyklus. */
export function planningContext(ctx, settings, rd) {
  const today = ctx.today || ctx.date;
  const asOf = ctx.date > today ? today : ctx.date;
  const fit = fitnessState({ activities: ctx.activities || [], days: ctx.days || [], settings, asOf });
  const wp = weeklyPlan(ctx.activities || [], ctx.date, { level: rd?.level || 'good', acwr: rd?.acwr ?? null });
  const block = { name: wp.deload || wp.c === 1 ? 'basis' : 'aufbau', week: wp.c, deload: wp.deload };
  return { fit, wp, block };
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
  const wd = weekday(date);
  const slot = slotOf(settings, date);
  const why = [];
  const rd = opts.provisional ? { level: 'good', signals: [], acwr: null } : opts.rd || readiness({ ...ctx, settings });
  const level = rd.level;
  const pc = opts.pc || planningContext(ctx, settings, rd);
  const { fit, wp, block } = pc;
  const base = { date, weekday: WEEKDAYS[wd], kind: slot.kind, label: slot.label, fixed: !!slot.fixed, block: { name: block.name, label: BLOCK_LABEL[block.name], week: block.week, deload: block.deload }, provisional: !!opts.provisional, moved: !!settings._ov?.[date] && settings._ov[date] !== (settings.week[wd]?.kind || 'rest') };

  const loadHigh = rd.signals?.some((s) => s.id === 'R-LOAD');
  const scaleWeek = block.deload ? 0.8 : loadHigh ? 0.85 : 1;
  const isLongDay = (d) => slotOf(settings, d).kind === 'run_long';
  const recentPain = (ctx.pain || []).some((x) => diffDays(date, x.date) >= 0 && diffDays(date, x.date) <= 7 && x.level >= RULES.painThreshold);
  const fitWhy = () => fit.source === 'läufe' && fit.anchor ? [{ rule: 'R-FIT', text: `Leistungsstand VDOT ${fit.vdot.toString().replace('.', ',')} (Beleg ${fit.anchor.date.slice(8, 10)}.${fit.anchor.date.slice(5, 7)}.: ${Math.round(fit.anchor.dur_s / 60)} min, Ø ${fmtPace(fit.anchor.pace_s)} /km, Puls ${fit.anchor.hr}${fit.trend != null ? `, Puls-Tempo-Trend ${fit.trend > 0 ? '+' : ''}${fit.trend.toString().replace('.', ',')} %` : ''}): Schwelle ${fmtPace(fit.paces.threshold)}, Intervall ${fmtPace(fit.paces.interval)}, locker ${fmtPace(fit.paces.easy)}` }] : [{ rule: 'R-FIT', text: `Noch kein harter Lauf als Beleg: Tempi aus deiner Schwellenpace (${fmtPace(settings.lt_pace_s)}), Leistungsstand wird mit den nächsten harten Läufen genauer` }];
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
    let easyInstead = false;
    const sigs = opts.provisional ? [] : rd.signals;
    if (!opts.provisional) {
      const medium = sigs.filter((s) => s.id !== 'R-LOAD');
      if (level === 'medium' && medium.length) why.push({ rule: medium[0].id, text: medium[0].text + ': Intervallzeit um 20 % gekürzt' });
      if (level === 'low') { easyInstead = true; for (const s of sigs.slice(0, 2)) why.push({ rule: s.id, text: s.text }); why.push({ rule: 'R-EASY', text: 'Mehrere Erholungssignale: statt Qualität ein lockerer Lauf' }); }
      if (missed.length >= 2) why.push({ rule: 'R-MISSED', text: `Zwei geplante Läufe ausgefallen (${missed.slice(-2).join(', ')}): Intervallzeit um 15 % reduziert` });
    }
    if (easyInstead) {
      const s = runEasy(Math.round(40 * scaleWeek), fit, settings, 'Lockerer Lauf statt Qualität');
      return { ...base, ...s, why, adjusted: true };
    }
    const pq = planQuality({ activities: acts, date, fit, rd, wp, pain: recentPain, isLongDay, provisional: !!opts.provisional, volScale: missed.length >= 2 ? 0.85 : 1 });
    const q = buildQuality(pq.structure, fit, settings);
    return { ...base, ...q, why: [...fitWhy(), ...(wp.deload ? [{ rule: 'R-DELOAD', text: wp.reason }] : []), ...pq.why, ...why], adjusted: (level === 'medium' && !opts.provisional) || missed.length >= 2, kindQ: pq.kind };
  }

  if (slot.kind === 'run_long') {
    const pq = planQuality({ activities: acts, date, fit, rd, wp, pain: recentPain, isLongDay, provisional: true });
    const qKm = buildQuality(pq.structure, fit, settings).targets.distance_km;
    const pl = planLong({ activities: acts, date, fit, rd, wp, qualityKm: qKm, provisional: !!opts.provisional });
    why.push(...pl.why);
    let scale = 1;
    if (!opts.provisional && level === 'medium') { scale = 0.85; const s = rd.signals.find((x) => x.id !== 'R-LOAD') || rd.signals[0]; if (s) why.push({ rule: s.id, text: s.text + ': langer Lauf um etwa 15 % kürzer, ohne Endteil' }); }
    if (!opts.provisional && level === 'low') { scale = 0.7; for (const s of rd.signals.slice(0, 2)) why.push({ rule: s.id, text: s.text }); why.push({ rule: 'R-EASY', text: 'Mehrere Erholungssignale: langer Lauf um 30 % kürzer' }); }
    const s = runLong(pl.km, pl.finish, fit, settings, { scale });
    return { ...base, ...s, why: [...fitWhy(), ...why], adjusted: scale < 1 };
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
  const ref = days.includes(today) ? today : days[6] < today ? days[6] : days[0];
  const pc = planningContext({ ...ctx, date: ref }, withDefaults(ctx.settings), rdToday);
  return days.map((d) => {
    const provisional = diffDays(d, today) > 0;
    const dctx = { ...ctx, date: d };
    return planDay(dctx, { provisional, pc, rd: provisional ? undefined : readiness({ ...ctx, date: d < today ? d : today }) });
  });
}
