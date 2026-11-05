import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmrTenHaaf, rmrMifflin, sessionKcal, dayEnergy, macros, weightTrend, trendAdvice, kcalFrom, baseSteps } from '../server/engine/energy.js';

const body = { height_cm: 188, weight_kg: 79, age: 25 };

test('Ruheumsatz: Mifflin und ten Haaf bei 188 cm, 79 kg, 25 Jahre', () => {
  assert.equal(Math.round(rmrMifflin(body)), 1845);
  assert.equal(Math.round(rmrTenHaaf(body)), 2065);
});

test('Lauf ca. 1 kcal pro kg und km, Rad nach Watt in kJ', () => {
  assert.equal(Math.round(sessionKcal({ sport: 'running', distance_m: 10000, ascent_m: 0 }, body)), 790);
  const k = sessionKcal({ sport: 'cycling', avg_power: 200, duration_s: 3600 }, body);
  assert.ok(k > 600 && k < 720, String(k)); // 720 kJ abzüglich Ruheanteil
});

test('Tagesbedarf: Ruhetag unter Trainingstag, langer Lauf am höchsten, Ist ersetzt Plan', () => {
  const mk = (plan, extra = {}) => dayEnergy({ settings: {}, date: '2026-11-05', plan, ...extra });
  const rest = mk({ kind: 'rest' }), q = mk({ kind: 'run_quality', targets: { distance_km: 10 } }), long = mk({ kind: 'run_long', targets: { distance_km: 16 } });
  assert.ok(rest.kcal < q.kcal && q.kcal < long.kcal);
  assert.ok(rest.low < rest.kcal && rest.kcal < rest.high);
  assert.equal(rest.exercise, 0);
  const ist = mk({ kind: 'run_quality', targets: { distance_km: 10 } }, { activities: [{ local_date: '2026-11-05', sport: 'running', distance_m: 5000 }] });
  assert.equal(ist.source, 'ist'); assert.ok(ist.kcal < q.kcal);
  assert.match(mk({ kind: 'rest' }, { nextPlan: { kind: 'run_long' } }).tip, /langer Lauf/);
});

test('Makros: Protein 1,8 g/kg, Fett 1 g/kg, Rest Kohlenhydrate', () => {
  const m = macros(3000, 79);
  assert.equal(m.protein_g, 142); assert.equal(m.fat_g, 79);
  assert.equal(Math.round(m.protein_g * 4 + m.fat_g * 9 + m.carbs_g * 4), 3000 - (3000 - Math.round(m.protein_g * 4 + m.fat_g * 9 + m.carbs_g * 4)));
});

test('Gewichtstrend und Empfehlung', () => {
  const log = [0, 7, 14, 21].map((i) => ({ date: new Date(Date.UTC(2026, 9, 15 + i)).toISOString().slice(0, 10), kg: 80 - i * 0.05 }));
  const slope = weightTrend(log, '2026-11-05');
  assert.ok(slope < -0.3 && slope > -0.4);
  assert.match(trendAdvice(slope).text, /mehr essen/);
  assert.equal(weightTrend([{ date: '2026-11-04', kg: 79 }], '2026-11-05'), null);
  assert.equal(trendAdvice(0.05).adjust, 0);
});

test('Garmin-Kalorien: erkennt gängige Feldnamen, sonst nichts', () => {
  assert.deepEqual(kcalFrom([{ calendarDate: '2026-11-04', activeKilocalories: 700, bmrKilocalories: 1900 }])['2026-11-04'], { total: 2600, active: 700, bmr: 1900 });
  assert.deepEqual(kcalFrom([{ calendarDate: '2026-11-04', steps: 1 }]), {});
});

test('Alltagsschritte: Median ohne Laufschritte, Rückfall ohne Daten', () => {
  assert.equal(baseSteps([], [], '2026-11-05'), 6500);
  const days = [1, 2, 3].map((i) => ({ date: `2026-11-0${i}`, steps: 8000 }));
  assert.equal(baseSteps(days, [], '2026-11-05'), 8000);
});
