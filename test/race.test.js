import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDay, planWeek, withDefaults } from '../server/engine/planner.js';
import { DEFAULT_SETTINGS } from '../server/engine/config.js';
import { raceInfo } from '../server/engine/race.js';
import { addDays } from '../server/engine/dates.js';

const mk = (goal) => withDefaults({ ...DEFAULT_SETTINGS, block_start: '2026-10-26', goal: { distance_km: 21.0975, time_s: 6600, date: null, ...goal } });
const ctx = (date, settings) => ({ date, today: date, settings, activities: [], days: [], strengthLog: [], pain: [], });
const fit = { vdot: 45 };

test('ohne Datum: kein Rennmodus, Plan wie bisher', () => {
  const s = mk({});
  assert.equal(raceInfo(s, '2026-10-27', fit), null);
  const w = planWeek(ctx('2026-10-27', s));
  assert.ok(w.every((d) => !d.race));
  assert.ok(!w.some((d) => d.kind === 'run_race'));
});

test('Phasen nach Wochen bis zum Rennen', () => {
  const s = mk({ date: '2027-01-30' });
  const ph = (d) => raceInfo(s, d, fit).phase;
  assert.equal(ph('2026-10-01'), 'basis');
  assert.equal(ph('2026-11-20'), 'aufbau');
  assert.equal(ph('2026-12-25'), 'spezifisch');
  assert.equal(ph('2027-01-18'), 'taper');
  assert.equal(ph('2027-01-27'), 'rennwoche');
});

test('Renntag: Wettkampfeinheit mit Zielpace', () => {
  const s = mk({ date: '2026-11-08' });
  const p = planDay(ctx('2026-11-08', s), { provisional: true });
  assert.equal(p.kind, 'run_race');
  assert.equal(p.targets.time_s, 6600);
});

test('Rennwoche: Spezifische Qualität nur Aktivierung, Tag davor locker', () => {
  const s = mk({ date: '2026-11-08' });
  const w = planWeek(ctx('2026-11-04', s));
  const day = (d) => w.find((x) => x.date === d);
  assert.equal(day('2026-11-07').kind === 'rest' || day('2026-11-07').kind === 'run_easy' || day('2026-11-07').kind === 'spinning', true);
  assert.ok(day('2026-11-08'));
});

test('Datum in der Vergangenheit: kein Rennmodus', () => {
  const s = mk({ date: '2026-10-01' });
  assert.equal(raceInfo(s, '2026-10-27', fit), null);
  assert.equal(addDays('2026-10-01', 1), '2026-10-02');
});
