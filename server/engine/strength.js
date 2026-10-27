// Kraft-Logbuch: Satzprotokoll, Vorgaben aus dem letzten Mal und Analyse der Gewichte.
import { buckets } from './buckets.js';

const r1 = (v) => Math.round(v * 10) / 10;
export const firstInt = (s) => { const m = String(s ?? '').match(/\d+/); return m ? Number(m[0]) : null; };
export const isTimed = (s) => /\d\s*(s|sek)\b/i.test(String(s ?? ''));
const doneOnly = (sets) => sets.filter((s) => s.done !== false && Number(s.reps) > 0);

/** Verdichtet Sätze zu einem Eintrag je Übung und Tag (Format, das der Planer für Lastvorschläge nutzt). */
export function legacyLog(sets) {
  const by = new Map();
  for (const s of sets) {
    const k = s.date + '|' + s.exercise_id;
    const e = by.get(k) || { date: s.date, exercise_id: s.exercise_id, weight_kg: null, done_all: true, rpe: null, n: 0 };
    e.n++;
    if (s.done === false) e.done_all = false;
    else if (s.weight_kg != null && (e.weight_kg == null || s.weight_kg > e.weight_kg)) e.weight_kg = s.weight_kg;
    by.set(k, e);
  }
  return [...by.values()].map(({ n, ...e }) => e);
}

/** Letzte Einheit einer Übung vor `beforeDate`. */
export function lastSession(sets, exId, beforeDate) {
  const rows = doneOnly(sets.filter((s) => s.exercise_id === exId && s.date < beforeDate));
  if (!rows.length) return null;
  const date = rows.map((s) => s.date).sort().pop();
  const day = rows.filter((s) => s.date === date).sort((a, b) => a.set_no - b.set_no);
  return { date, sets: day.map((s) => ({ kg: s.weight_kg ?? 0, reps: s.reps })) };
}

/**
 * Baut die Einheit: Übungen aus der eigenen Vorlage (falls vorhanden) oder aus dem Plan,
 * je Übung die letzte Einheit und vorbefüllte Sätze.
 */
export function sessionFor({ plan, kind, template, sets, date }) {
  const planned = plan?.exercises || [];
  const base = template?.[kind]?.length ? template[kind] : planned.map((e) => ({ id: e.id, name: e.name, sets: e.sets, reps: e.reps }));
  const exercises = base.map((b) => {
    const p = planned.find((e) => e.id === b.id);
    const last = lastSession(sets, b.id, date);
    const lastTop = last ? Math.max(...last.sets.map((s) => s.kg)) : null;
    const suggest = p?.weight_kg ?? lastTop;
    const timed = isTimed(b.reps);
    const n = Math.max(1, Math.min(10, Number(b.sets) || 3));
    const prefill = Array.from({ length: n }, (_, i) => ({
      kg: p?.weight_kg ?? last?.sets[i]?.kg ?? lastTop ?? 0,
      reps: firstInt(b.reps) ?? last?.sets[i]?.reps ?? 8,
    }));
    return {
      id: b.id, name: b.name, sets: n, reps: String(b.reps ?? ''), timed,
      weight_kg: suggest ?? null,
      delta_kg: suggest != null && lastTop != null && suggest > lastTop ? r1(suggest - lastTop) : null,
      note: p?.note || null,
      last, prefill, custom: !p,
    };
  });
  const minutes = plan?.targets?.duration_min ?? Math.round(10 + exercises.reduce((a, e) => a + e.sets * 3.2, 0));
  return { date, kind, title: plan?.title || (kind === 'strength_x' ? 'Eigenes Training' : kind === 'strength_b' ? 'Kraft B' : 'Kraft A'), summary: plan?.summary || '', duration_min: minutes, exercises, customized: !!template?.[kind]?.length };
}

const mostCommon = (xs) => { const c = {}; xs.forEach((x) => { c[x] = (c[x] || 0) + 1; }); return Number(Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]); };

export function strengthAnalysis({ sets, range, ex, date }) {
  const { list, sub } = buckets(range, date);
  const done = doneOnly(sets);
  const counts = new Map();
  for (const s of done) { const c = counts.get(s.exercise_id) || { id: s.exercise_id, name: s.exercise_name, n: 0 }; c.n++; counts.set(s.exercise_id, c); }
  const exercises = [...counts.values()].sort((a, b) => b.n - a.n).map(({ id, name }) => ({ id, name }));
  const sel = exercises.find((e) => e.id === ex) || exercises[0] || null;

  const out = { range, sub, labels: list.map((b) => b.label), exercises, ex: sel, weight: [], vol: [], sessions: [], hist: [] };
  let sessions = 0, vol = 0, nSets = 0;
  for (const b of list) {
    if (b.future) { out.weight.push(null); out.vol.push(null); out.sessions.push(null); continue; }
    const inB = done.filter((s) => s.date >= b.from && s.date <= b.to);
    const w = sel ? inB.filter((s) => s.exercise_id === sel.id && s.weight_kg != null).map((s) => s.weight_kg) : [];
    out.weight.push(w.length ? Math.max(...w) : null);
    const v = inB.reduce((a, s) => a + (s.weight_kg || 0) * s.reps, 0) / 1000;
    out.vol.push(r1(v));
    const sess = new Set(inB.map((s) => s.date)).size;
    out.sessions.push(sess);
    sessions += sess; vol += v; nSets += inB.length;
  }
  out.kpis = { sessions, volume_t: r1(vol), sets: nSets };

  if (sel) {
    const dates = [...new Set(done.filter((s) => s.exercise_id === sel.id && s.date <= date).map((s) => s.date))].sort().reverse().slice(0, 5);
    const rows = dates.map((d) => {
      const day = done.filter((s) => s.exercise_id === sel.id && s.date === d);
      return { date: d, sets: day.length, reps: mostCommon(day.map((s) => s.reps)), kg: Math.max(...day.map((s) => s.weight_kg || 0)) };
    });
    out.hist = rows.slice(0, 4).map((h, i) => ({ ...h, delta: rows[i + 1] ? r1(h.kg - rows[i + 1].kg) : null }));
  }
  return out;
}
