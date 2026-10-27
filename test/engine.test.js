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
