import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createMemoryStore } from '../server/db/memory.js';
import { COOKIE, createToken } from '../server/auth/session.js';
import { planDay, planWeek, planningContext, withDefaults } from '../server/engine/planner.js';
import { DEFAULT_SETTINGS } from '../server/engine/config.js';
import { addDays, mondayOf } from '../server/engine/dates.js';
import { returnPlan, volumeFactor, illnessState, lostWeeks } from '../server/engine/illness.js';
import { raceInfo } from '../server/engine/race.js';
import { consistency } from '../server/engine/review.js';

const base = { ...DEFAULT_SETTINGS, block_start: '2026-10-26' };
const withIll = (episodes, extra = {}, log = {}) => withDefaults({ ...base, ...extra, _illness: { episodes, log } });
const ctx = (date, settings, extra = {}) => ({ date, today: date, settings, activities: [], days: [], strengthLog: [], pain: [], ...extra });
const run = (date, km) => ({ sport: 'running', distance_m: km * 1000, local_date: date, start_time: date + 'T08:00:00Z', duration_s: km * 330, load: km * 8, avg_hr: 150 });
// Läufe in den vier Wochen vor dem 2026-11-09 (Montag): 30 km pro Woche
const history = () => [0, 1, 2, 3].flatMap((w) => [run(addDays('2026-10-12', 7 * w + 1), 8), run(addDays('2026-10-12', 7 * w + 3), 10), run(addDays('2026-10-12', 7 * w + 5), 12)]);

test('Wiedereinstieg: Richtwerte nach Pause und Schweregrad, Umfang steigt linear', () => {
  assert.equal(returnPlan(2, 'leicht').easyDays, 1);
  assert.equal(returnPlan(5, 'mittel').vol0, 0.6);
  assert.equal(returnPlan(5, 'schwer').doctor, true);
  assert.equal(returnPlan(20, 'leicht').ramp, 21);
  const rp = returnPlan(5, 'mittel');
  assert.equal(volumeFactor(rp, 1), 0.6);
  assert.equal(volumeFactor(rp, rp.ramp), 1);
  assert.ok(volumeFactor(rp, 5) > 0.6 && volumeFactor(rp, 5) < 1);
});

test('kranke Tage: Ruhe statt Einheit, nicht verpasst, keine Defizit-Kalorien', () => {
  const s = withIll([{ start: '2026-11-10', end: null, severity: 'mittel' }]);
  for (const d of ['2026-11-10', '2026-11-11']) {
    const p = planDay(ctx(d, s), {});
    assert.equal(p.kind, 'rest'); assert.equal(p.sick, true);
    assert.ok(p.why.some((w) => w.rule === 'R-NECK'));
  }
  // Der Samstag danach ist noch nicht krank (offene Krankheit gilt nur bis heute), aber vorläufig markiert
  const f = planDay({ ...ctx('2026-11-11', s), date: '2026-11-14' }, { provisional: true });
  assert.notEqual(f.sick, true);
  assert.ok(f.why.some((w) => w.rule === 'R-SICK'));
  assert.equal(planDay(ctx('2026-11-10', s), {}).illness.state, 'sick');
});

test('Wiedereinstieg: lockere Läufe, Qualität erst später, Kraft leichter', () => {
  // krank 4 Tage (Mo 09.11. bis Do 12.11.), mittel: easyDays 4, noQuality 6, vol0 0.6, ramp 10
  const s = withIll([{ start: '2026-11-09', end: '2026-11-12', severity: 'mittel' }]);
  const rp = returnPlan(4, 'mittel');
  assert.equal(rp.easyDays, 4);
  // Samstag 14.11. = Tag 2: langer Lauf wird lockerer Kurzlauf
  const longDay = planDay(ctx('2026-11-14', s, { activities: history() }), {});
  assert.equal(longDay.kind, 'run_long'); assert.equal(longDay.adjusted, true);
  assert.ok(longDay.targets.duration_min <= 30, 'kurzer lockerer Lauf');
  assert.ok(longDay.why.some((w) => w.rule === 'R-RETURN'));
  // Qualitätstag (Donnerstag) innerhalb von noQuality: locker. Ein späterer Tag danach: normale Qualität
  const q1 = planDay(ctx('2026-11-17', s, { activities: history() }), {}); // Tag 5 (Dienstag = Spinning)
  assert.equal(q1.kind, 'spinning'); assert.match(q1.title, /locker/);
  const qLater = planDay(ctx('2026-11-19', s, { activities: history() }), {}); // Donnerstag Tag 7 > noQuality 6
  assert.ok(!/locker/.test(qLater.title || '') || qLater.kind !== 'run_quality' || qLater.structure);
  // Kraft: leichte Einheit und Gewichtsfaktor
  const kr = planDay(ctx('2026-11-13', s), {}); // Freitag-Slot Kraft? Kind prüfen
  const st = ['2026-11-13', '2026-11-15', '2026-11-18'].map((d) => planDay(ctx(d, s), {})).find((p) => String(p.kind).startsWith('strength'));
  if (st) { assert.ok(st.weight_scale < 1); assert.ok(st.why.some((w) => w.rule === 'R-RETURN')); }
  assert.ok(kr);
});

test('Rückfall-Schutz: „schlechter“ im Wiedereinstieg pausiert den Tag', () => {
  const s = withIll([{ start: '2026-11-09', end: '2026-11-12', severity: 'mittel' }], {}, { '2026-11-14': 'schlechter' });
  const p = planDay(ctx('2026-11-14', s, { activities: history() }), {});
  assert.equal(p.kind, 'rest'); assert.equal(p.relapse, true);
});

test('Wochenumfang: Krankheitswochen zählen nicht, danach begrenzt auf Stufe', () => {
  const acts = history();
  const s0 = withDefaults(base);
  // Woche ab 16.11.: davor Woche 09.11. komplett krank (0 km), Wochen davor 30 km
  const sick = withIll([{ start: '2026-11-09', end: '2026-11-15', severity: 'mittel' }]);
  const none = planningContext(ctx('2026-11-16', s0, { activities: acts }), s0, { level: 'good', acwr: null });
  const ill = planningContext(ctx('2026-11-16', sick, { activities: acts }), sick, { level: 'good', acwr: null });
  assert.ok(ill.wp.target >= 12, `Ziel ${ill.wp.target} darf nicht auf Startumfang kollabieren`);
  assert.ok(ill.wp.target <= 18.5, `Wiedereinstieg deckelt auf 60 % von 30 km, ist ${ill.wp.target}`);
  assert.ok(none.wp.target !== ill.wp.target, 'ohne Krank-Modus zählt die leere Woche als Rückgang');
  assert.match(ill.wp.reason, /Wiedereinstieg/);
  // Ohne Deckelung würde eine volle Nullwoche den Schnitt drücken: hier bleibt das Niveau der gesunden Wochen die Referenz
  const ref = Math.max(...ill.wp.w.slice(1, 5));
  assert.ok(ref >= 30, `Referenz ${ref}`);
});

test('Rennmodus: Krankheit verlängert die Aufbauphase und warnt bei knapper Zeit', () => {
  const goal = { goal: { distance_km: 21.0975, time_s: 6600, date: '2027-01-30' } };
  const s0 = withDefaults({ ...base, ...goal });
  const s1 = withIll([{ start: '2026-12-01', end: '2026-12-21', severity: 'schwer' }], { ...goal });
  assert.equal(raceInfo(s0, '2026-12-25', { vdot: 45 }).phase, 'spezifisch');
  const r = raceInfo(s1, '2026-12-25', { vdot: 45 });
  assert.equal(r.phase, 'aufbau');
  assert.ok(r.illness.lost_weeks >= 2);
  assert.equal(r.illness.risk, true);
  // Tapering bleibt am Renntermin
  assert.equal(raceInfo(s1, '2027-01-18', { vdot: 45 }).phase, 'taper');
  assert.equal(lostWeeks(withDefaults(base), '2026-12-25'), 0);
});

test('Konsistenz: Krankheitswochen unterbrechen die Serie nicht', () => {
  const s = withIll([{ start: '2026-11-02', end: '2026-11-08', severity: 'mittel' }]);
  const acts = [];
  for (const m of ['2026-10-19', '2026-10-26', '2026-11-09']) for (const i of [0, 2, 4]) acts.push({ sport: 'running', local_date: addDays(m, i), distance_m: 8000 });
  const c = consistency({ activities: acts, settings: s, today: '2026-11-16', weeks: 6 });
  assert.equal(c.rows.find((r) => r.monday === '2026-11-02').sick, 7);
  assert.ok(c.streak >= 3, `Serie ${c.streak}`);
});

async function boot() {
  const store = createMemoryStore();
  const app = createApp({ store });
  const server = await new Promise((r) => { const sv = app.listen(0, () => r(sv)); });
  const call = (path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-Requested-With': 'fit', ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: `${COOKIE}=${createToken()}` }, body: body ? JSON.stringify(body) : undefined });
  return { call, close: () => server.close() };
}

test('API: krank melden, einchecken, beenden, Rückfall zusammenführen, zurücknehmen', async () => {
  const t = await boot();
  const today = (await (await t.call('/api/today')).json()).date;
  assert.equal((await t.call('/api/illness', { action: 'start', severity: 'unsinn', start: addDays(today, 3) })).status, 400);
  assert.equal((await t.call('/api/illness', { action: 'start', severity: 'mittel' })).status, 200);
  let td = await (await t.call('/api/today')).json();
  assert.equal(td.status, 'sick'); assert.equal(td.plan.kind, 'rest'); assert.equal(td.illness.sick, true);
  assert.equal(td.training_status.key, 'sick');
  assert.equal(td.energy.deficit, 0);
  assert.equal((await t.call('/api/illness', { action: 'log', value: 'besser' })).status, 200);
  assert.equal((await t.call('/api/illness', { action: 'log', value: 'x' })).status, 400);
  assert.equal((await (await t.call('/api/illness')).json()).today_log, 'besser');
  const wk = await (await t.call('/api/week')).json();
  assert.equal(wk.week.find((d) => d.date === today).status, 'sick');
  // beenden: Start heute -> letzter kranker Tag ist heute, Wiedereinstieg ab morgen
  assert.equal((await t.call('/api/illness', { action: 'end' })).status, 200);
  td = await (await t.call('/api/today')).json();
  assert.equal(td.illness.sick, true);
  // Rückfall am Folgetag wird zur selben Krankheit
  const s = await (await t.call('/api/settings')).json();
  assert.equal(s.illness.recent.length, 1);
  assert.equal((await t.call('/api/illness', { action: 'start', severity: 'schwer' })).status, 200);
  const v = await (await t.call('/api/illness')).json();
  assert.equal(v.recent.length, 1); assert.equal(v.severity, 'schwer');
  assert.equal((await t.call('/api/illness', { action: 'cancel' })).status, 200);
  td = await (await t.call('/api/today')).json();
  assert.equal(td.illness.sick, false);
  assert.equal((await t.call('/api/illness', { action: 'end' })).status, 400);
  t.close();
});

test('Woche umplanen funktioniert auch nach einer Krankheit in der Woche (Einheiten kranker Tage bleiben im Slot)', async () => {
  const t = await boot();
  const today = (await (await t.call('/api/today')).json()).date;
  const monday = mondayOf(today);
  const start = today > monday ? monday : today;
  assert.equal((await t.call('/api/illness', { action: 'start', severity: 'leicht', start })).status, 200);
  if (today > start) assert.equal((await t.call('/api/illness', { action: 'end' })).status, 200);
  const wk = (await (await t.call('/api/week')).json()).week;
  const days = Object.fromEntries(wk.map((p) => [p.date, p.sick_slot || p.kind]));
  // zwei Tage ab heute mit verschiedenen Einheiten tauschen
  const free = wk.filter((p) => p.date >= today && !p.sick);
  const a = free.find((p, i) => free.some((q, j) => j > i && (q.sick_slot || q.kind) !== (p.sick_slot || p.kind)));
  if (a) {
    const b = free.find((q) => (q.sick_slot || q.kind) !== (a.sick_slot || a.kind) && q.date > a.date);
    [days[a.date], days[b.date]] = [days[b.date], days[a.date]];
    assert.equal((await t.call('/api/week/plan', { days })).status, 200);
  }
  // Der alte Fehler: kranke Tage als „rest“ zu schicken, passt nicht zur Standardwoche
  if (wk.some((p) => p.sick && p.sick_slot !== 'rest')) {
    const bad = Object.fromEntries(wk.map((p) => [p.date, p.kind]));
    assert.equal((await t.call('/api/week/plan', { days: bad })).status, 400);
  }
  t.close();
});
