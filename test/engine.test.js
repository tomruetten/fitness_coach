import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneBounds, zoneOf, fmtPace, parsePace } from '../server/engine/zones.js';
import { edwardsLoad } from '../server/engine/load.js';
import { planDay, planWeek, readiness, withDefaults } from '../server/engine/planner.js';
import { DEFAULT_SETTINGS } from '../server/engine/config.js';
import { addDays, mondayOf } from '../server/engine/dates.js';

const settings = withDefaults({ ...DEFAULT_SETTINGS, block_start: '2026-10-26' });
const ctx = (date, extra = {}) => ({ date, today: date, settings, activities: [], days: [], strengthLog: [], pain: [], ...extra });

test('Zonen aus Schwellenpuls 181', () => {
  assert.equal(zoneOf(150, 181), 1);
  assert.equal(zoneOf(158, 181), 2);
  assert.equal(zoneOf(185, 181), 5);
  assert.equal(parsePace(fmtPace(298)), 298);
});

test('Datumshelfer', () => {
  assert.equal(mondayOf('2026-10-29'), '2026-10-26');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('Wochenplan: feste Sportart je Wochentag', () => {
  const w = planWeek(ctx('2026-10-27'));
  assert.deepEqual(w.map((d) => d.kind), ['rest', 'spinning', 'strength_a', 'run_quality', 'rest', 'run_long', 'strength_b']);
});

test('Schwache Erholung ersetzt Qualität durch lockeren Lauf', () => {
  const days = Array.from({ length: 70 }, (_, i) => {
    const date = addDays('2026-08-20', i);
    return { date, hrv_avg: i > 62 ? 30 : 60 + (i % 3), resting_hr: i > 62 ? 60 : 48, sleep_h: i > 62 ? 5.5 : 7.5 };
  });
  const c = ctx('2026-10-29', { days });
  const rd = readiness(c);
  assert.notEqual(rd.level, 'good');
  const p = planDay(c, { rd });
  assert.ok(p.why.length > 0);
});

test('Schmerz entfernt belastende Übungen oder meldet es', () => {
  const c = ctx('2026-10-28', { pain: [{ date: '2026-10-27', level: 6, area: 'Knie' }] });
  const p = planDay(c, { rd: readiness(c) });
  assert.ok(p.why.some((w) => w.rule === 'R-PAIN'));
});

test('Edwards-Load wächst mit der Zeit in hohen Zonen', () => {
  assert.ok(edwardsLoad([0, 0, 0, 600, 0]) > edwardsLoad([0, 600, 0, 0, 0]));
});

import { mapHealth, listOf } from '../server/garmin/sync.js';
test('Garmin-Antworten in verschiedenen Verpackungen werden gelesen', () => {
  assert.equal(listOf([{ a: 1 }]).length, 1);
  assert.equal(listOf({ hrvSummaries: [{ a: 1 }, { a: 2 }] }, 'hrvSummaries').length, 2);
  assert.equal(listOf({ irgendwas: [{ a: 1 }] }).length, 1);
  const rows = mapHealth({
    summaries: [{ calendarDate: '2026-10-01', heartRate: { restingValue: 50 } }],
    sleeps: [{ calendarDate: '2026-10-01', sleepTimeSeconds: 25000 }],
    hrvs: [{ calendarDate: '2026-10-01', lastNightAvg: 55, status: 'BALANCED' }],
  });
  assert.deepEqual([rows[0].resting_hr, rows[0].sleep_s, rows[0].hrv_avg], [50, 25000, 55]);
});

import { vdotOf, predictTime, paceAtFrac, fitnessState } from '../server/engine/fitness.js';
import { weeklyPlan } from '../server/engine/progression.js';
import { loadModel } from '../server/engine/load.js';

test('VDOT: Rennen 14 km in 71 min und Prognose passen zusammen', () => {
  const v = vdotOf(14000, 71 * 60);
  assert.ok(v > 39.5 && v < 41.5, `VDOT ${v}`);
  // Halbmarathon-Prognose liegt bei diesem Leistungsstand nahe 1:50
  const hm = predictTime(v, 21097.5);
  assert.ok(hm > 6500 && hm < 6750, `HM ${hm}`);
  // Schwelle liegt bei diesem VDOT um 5:00 min/km, VO2max-Intervalle deutlich schneller
  assert.ok(paceAtFrac(v, 0.88) > 295 && paceAtFrac(v, 0.88) < 312);
  assert.ok(paceAtFrac(v, 0.98) < paceAtFrac(v, 0.88) - 20);
});

test('Leistungsstand: harter Lauf zählt, lockerer nicht, Alterung senkt langsam', () => {
  const s = withDefaults({ ...DEFAULT_SETTINGS });
  const hard = { sport: 'running', distance_m: 14000, duration_s: 4260, avg_hr: 181, local_date: '2026-10-20', km_splits: [], best: {} };
  const easy = { sport: 'running', distance_m: 10000, duration_s: 3700, avg_hr: 150, local_date: '2026-10-28', km_splits: [], best: { m30: { pace_s: 370, hr: 150 } } };
  const f1 = fitnessState({ activities: [hard, easy], settings: s, asOf: '2026-11-03' });
  assert.equal(f1.source, 'läufe');
  assert.ok(f1.anchor.date === '2026-10-20');
  const f2 = fitnessState({ activities: [hard], settings: s, asOf: '2027-01-05' });
  assert.ok(f2.vdot < f1.vdot && f2.vdot > f1.vdot * 0.93);
  const none = fitnessState({ activities: [easy], settings: s, asOf: '2026-11-03' });
  assert.equal(none.source, 'einstellungen');
});

test('Wochenumfang: +10 %, nach drei Belastungswochen Entlastung, danach neuer Zyklus', () => {
  const run = (date, km) => ({ sport: 'running', distance_m: km * 1000, local_date: date });
  const acts = (kms) => kms.map((km, i) => run(addDays('2026-11-02', -7 * (kms.length - i)), km));
  const up = weeklyPlan(acts([20, 22, 24]), '2026-11-03');
  assert.equal(up.deload, true);
  assert.ok(up.target < 24);
  const mid = weeklyPlan(acts([20, 22]), '2026-11-03');
  assert.equal(mid.deload, false);
  assert.ok(mid.target > 22 && mid.target <= 24.5);
  const after = weeklyPlan(acts([20, 22, 24, 18.5]), '2026-11-03');
  assert.equal(after.c, 1);
  assert.ok(after.target >= 23);
  const start = weeklyPlan([], '2026-11-03');
  assert.equal(start.target, 20);
});

test('Belastungsmodell: Ruhe senkt akut schneller als chronisch', () => {
  const acts = Array.from({ length: 28 }, (_, i) => ({ start_time: addDays('2026-10-01', i) + 'T10:00:00Z', load: i % 2 ? 100 : 0 }));
  const m = loadModel(acts, '2026-10-28');
  assert.ok(m.ratio != null);
  const rested = loadModel(acts, '2026-11-04');
  assert.ok(rested.ratio < m.ratio);
});
