import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSession, matchingActivities } from '../server/engine/evaluate.js';

const plan = { kind: 'run_long', targets: { distance_km: 10, pace_s: 360, hr_from: 140, hr_to: 155, duration_min: 60 } };
const act = (o) => ({ id: 1, sport: 'running', local_date: '2026-11-03', distance_m: 10000, duration_s: 3600, avg_hr: 150, zone_s: [600, 2800, 200, 0, 0], ...o });

test('Plan getroffen: hohe Note', () => {
  const ev = evaluateSession({ plan, activities: [act()], date: '2026-11-03' });
  assert.ok(ev.score >= 85, String(ev.score));
});
test('Zu schnell und zu hoher Puls: niedrige Note und Hinweis', () => {
  const ev = evaluateSession({ plan, activities: [act({ avg_hr: 175, duration_s: 3000, zone_s: [0, 200, 1500, 1300, 0] })], date: '2026-11-03' });
  assert.ok(ev.score < 55);
  assert.ok(ev.impact.some((x) => x.includes('zu intensiv')));
});
test('Passende Aktivität: nur gleiche Sportart am Tag, Ruhetag nie', () => {
  assert.equal(matchingActivities(plan, [act({ sport: 'cycling' })], '2026-11-03').length, 0);
  assert.equal(matchingActivities({ kind: 'rest' }, [act()], '2026-11-03').length, 0);
  assert.equal(evaluateSession({ plan, activities: [], date: '2026-11-03' }), null);
});
