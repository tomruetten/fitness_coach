// Wochenrückblick und Konsistenz: reine Funktionen auf Aktivitäten, Tageswerten und Planung.
import { addDays, mondayOf, diffDays } from './dates.js';
import { fitnessState } from './fitness.js';

const isRun = (a) => a.sport === 'running' && a.distance_m > 1500;
const sumKm = (xs) => xs.filter(isRun).reduce((s, a) => s + a.distance_m, 0) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const dec = (v, n = 1) => v.toFixed(n).replace('.', ',');
const grp = (a) => (a.sport === 'running' ? 'run' : a.sport === 'strength' ? 'strength' : a.sport === 'cycling' ? 'spin' : 'other');

/** Rückblick auf die Woche, die am Montag `monday` beginnt. `planned`: Pläne dieser Woche (planWeek). */
export function weekReview({ activities, days, settings, monday, planned }) {
  const to = addDays(monday, 6);
  const inW = activities.filter((a) => a.local_date >= monday && a.local_date <= to);
  const prev = [1, 2, 3, 4].map((i) => sumKm(activities.filter((a) => a.local_date >= addDays(monday, -7 * i) && a.local_date <= addDays(monday, -7 * i + 6))));
  const avg4 = mean(prev.filter((v) => v > 0));
  const km = sumKm(inW), runs = inW.filter(isRun);
  const plannedKm = (planned || []).reduce((s, p) => s + (String(p.kind).startsWith('run') ? Number(p.targets?.distance_km) || 0 : 0), 0);
  const slots = (planned || []).filter((p) => p.kind !== 'rest');
  const done = slots.filter((p) => inW.some((a) => a.local_date === p.date && (grp(a) === (String(p.kind).startsWith('run') ? 'run' : String(p.kind).startsWith('strength') ? 'strength' : 'spin'))) || settings._status?.[p.date] === 'done').length;
  const zt = [0, 0, 0, 0, 0]; runs.forEach((r) => (r.zone_s || []).forEach((s, i) => { zt[i] += s; }));
  const zs = zt.reduce((a, b) => a + b, 0);
  const easy = zs ? Math.round(((zt[0] + zt[1]) / zs) * 100) : null;
  const fitStart = fitnessState({ activities: activities.filter((a) => a.local_date < monday), days: days.filter((d) => d.date < monday), settings, asOf: addDays(monday, -1) });
  const fitEnd = fitnessState({ activities: activities.filter((a) => a.local_date <= to), days: days.filter((d) => d.date <= to), settings, asOf: to });
  const dVdot = fitEnd.source === 'läufe' && fitStart.source === 'läufe' ? r1(fitEnd.vdot - fitStart.vdot) : null;
  const wd = days.filter((d) => d.date >= monday && d.date <= to);
  const sleep = mean(wd.map((d) => (d.sleep_s > 0 ? d.sleep_s / 3600 : NaN)));
  const hrv = mean(wd.map((d) => d.hrv_avg));
  const hrvBase = mean(days.filter((d) => d.date >= addDays(monday, -60) && d.date < monday).map((d) => d.hrv_avg));
  const longest = runs.reduce((m, r) => Math.max(m, r.distance_m), 0) / 1000;
  const lines = [];
  if (plannedKm > 0 && slots.length) lines.push(`${done} von ${slots.length} Einheiten umgesetzt, ${dec(km)} von ${dec(plannedKm)} km gelaufen.`);
  else lines.push(`${dec(km)} km in ${runs.length} ${runs.length === 1 ? 'Lauf' : 'Läufen'}.`);
  if (avg4 && km > 0) { const d = Math.round(((km - avg4) / avg4) * 100); lines.push(d > 10 ? `${d} % mehr Umfang als dein Vier-Wochen-Schnitt. Eine Entlastung ist bald sinnvoll.` : d < -25 ? `${-d} % weniger Umfang als dein Schnitt (Entlastung oder Pause).` : 'Umfang im Rahmen deines Vier-Wochen-Schnitts.'); }
  if (easy != null) lines.push(easy >= 78 ? `${easy} % der Laufzeit locker: sehr gut verteilt.` : `Nur ${easy} % locker. Ziel sind etwa 80 %.`);
  if (dVdot != null && Math.abs(dVdot) >= 0.2) lines.push(dVdot > 0 ? `Leistungsstand +${dec(dVdot)} VDOT.` : `Leistungsstand ${dec(dVdot)} VDOT.`);
  if (hrv != null && hrvBase != null && hrv < hrvBase * 0.9) lines.push(`HRV im Schnitt ${Math.round(hrv)} ms, unter deinem Normalwert von ${Math.round(hrvBase)} ms.`);
  if (sleep != null && sleep < 6.8) lines.push(`Schlaf im Schnitt ${dec(sleep)} h. Mehr Schlaf macht das Training wirksamer.`);
  return { monday, to, km: r1(km), planned_km: r1(plannedKm), runs: runs.length, sessions_done: done, sessions_planned: slots.length, avg4_km: avg4 == null ? null : r1(avg4), easy_pct: easy, vdot_delta: dVdot, longest_km: r1(longest), sleep_h: sleep == null ? null : r1(sleep), hrv: hrv == null ? null : Math.round(hrv), lines };
}

/** Konsistenz: die letzten `weeks` Wochen als Raster (Mo–So) und die aktuelle Serie. */
export function consistency({ activities, settings, today, weeks = 12 }) {
  const m0 = mondayOf(today);
  const status = settings._status || {};
  const rows = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const mon = addDays(m0, -7 * w);
    const cells = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(mon, i);
      const acts = activities.filter((a) => a.local_date === date);
      const set = [...new Set(acts.map(grp))];
      if (status[date] === 'done' && !set.length) set.push('done');
      return { date, s: set, skip: status[date] === 'skipped', future: date > today };
    });
    rows.push({ monday: mon, cells, n: cells.reduce((s, c) => s + (c.s.length ? 1 : 0), 0) });
  }
  // Serie: aufeinanderfolgende Wochen (rückwärts ab der letzten vollen Woche) mit mindestens 3 aktiven Tagen
  let streak = 0;
  const complete = rows.filter((r) => addDays(r.monday, 6) < today);
  for (let i = complete.length - 1; i >= 0; i--) { if (complete[i].n >= 3) streak++; else break; }
  const cur = rows[rows.length - 1];
  if (cur.n >= 3 && streak > 0) streak++;
  else if (cur.n >= 3 && streak === 0 && complete.length === 0) streak = 1;
  const active = rows.reduce((s, r) => s + r.n, 0);
  return { rows, streak, active_days: active, weeks, since: rows[0].monday, diff: diffDays(today, rows[0].monday) };
}
