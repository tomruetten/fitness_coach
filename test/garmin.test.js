import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planToWorkout } from '../server/garmin/workout.js';
import { setHttp } from '../server/garmin/connect.js';
import { createApp } from '../server/app.js';
import { createMemoryStore } from '../server/db/memory.js';
import { COOKIE, createToken } from '../server/auth/session.js';

const seg = (m, k, pace_s) => ({ m, k, pace_s });
const vo2 = { kind: 'run_quality', title: 'VO2max 4 × 4 min', summary: 'Intervalle', profile: [seg(15, 'easy', 366), seg(4, 'int', 258), seg(3, 'rec', 366), seg(4, 'int', 258), seg(3, 'rec', 366), seg(4, 'int', 258), seg(3, 'rec', 366), seg(4, 'int', 258), seg(10, 'easy', 366)] };

test('Intervalle werden zu Aufwärmen, Wiederholungsgruppe, letzter Belastung und Auslaufen', () => {
  const w = planToWorkout(vo2);
  const s = w.workoutSegments[0].workoutSteps;
  assert.deepEqual(s.map((x) => x.type), ['ExecutableStepDTO', 'RepeatGroupDTO', 'ExecutableStepDTO', 'ExecutableStepDTO']);
  assert.equal(s[0].stepType.stepTypeKey, 'warmup');
  assert.equal(s[1].numberOfIterations, 3);
  assert.deepEqual(s[1].workoutSteps.map((x) => x.stepType.stepTypeKey), ['interval', 'recovery']);
  assert.equal(s[1].workoutSteps[0].endConditionValue, 240);
  assert.equal(s[2].stepType.stepTypeKey, 'interval');
  assert.equal(s[3].stepType.stepTypeKey, 'cooldown');
  const mps = 1000 / 258;
  assert.ok(s[1].workoutSteps[0].targetValueOne > mps && s[1].workoutSteps[0].targetValueTwo < mps);
  // Gesamtdauer bleibt wie geplant: 15 + 4 × 4 + 3 × 3 + 10 = 50 min
  const total = (st) => st.reduce((a, x) => a + (x.type === 'RepeatGroupDTO' ? x.numberOfIterations * total(x.workoutSteps) : x.endConditionValue), 0);
  assert.equal(total(s), 50 * 60);
});

test('Langer Lauf mit Endbeschleunigung und Nicht-Läufe', () => {
  const w = planToWorkout({ kind: 'run_long', title: 'Langer Lauf', profile: [seg(60, 'easy', 366), seg(10, 'thr', 300)] });
  assert.deepEqual(w.workoutSegments[0].workoutSteps.map((x) => x.stepType.stepTypeKey), ['interval', 'interval']);
  assert.equal(planToWorkout({ kind: 'strength_a', title: 'Kraft', profile: [] }), null);
  assert.equal(planToWorkout({ kind: 'rest' }), null);
});

async function boot() {
  const store = createMemoryStore();
  const server = await new Promise((r) => { const s = createApp({ store }).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'X-Requested-With': 'fit', 'Content-Type': 'application/json', Cookie: `${COOKIE}=${createToken()}` }, body: body ? JSON.stringify(body) : undefined });
  return { store, call, close: () => server.close() };
}

test('Senden: erneuert Token, legt an, plant ein und ersetzt beim zweiten Mal', async () => {
  const t = await boot();
  const calls = [];
  setHttp(async (url, opt = {}) => {
    const u = String(url); calls.push(`${opt.method || 'GET'} ${new URL(u).pathname}`);
    if (u.includes('thegarth')) throw new Error('offline');
    if (u.includes('/oauth/exchange/user/2.0')) return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }), { status: 200 });
    if (u.endsWith('/workout-service/workout') && opt.method === 'POST') return new Response(JSON.stringify({ workoutId: calls.length }), { status: 200 });
    return new Response('', { status: 200 });
  });
  try {
    // nicht verbunden
    const week = await (await t.call('/api/week')).json();
    const day = week.week.find((p) => p.garmin_can && p.date >= week.today);
    assert.ok(day, 'es gibt einen Lauf in dieser Woche');
    let r = await t.call('/api/garmin/send', { date: day.date });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).reconnect, true);
    // verbunden
    await t.store.setSetting('garmin_oauth', { oauthToken: 'a', oauthTokenSecret: 'b' });
    r = await t.call('/api/garmin/send', { date: day.date });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    assert.ok(calls.some((c) => c === 'POST /workout-service/workout'));
    assert.ok(calls.some((c) => c.startsWith('POST /workout-service/schedule/')));
    assert.ok((await (await t.call('/api/week')).json()).week.find((p) => p.date === day.date).garmin_sent);
    // erneut senden löscht das alte Training
    r = await t.call('/api/garmin/send', { date: day.date });
    assert.equal(r.status, 200);
    assert.ok(calls.some((c) => c.startsWith('DELETE /workout-service/workout/')));
    // Datum in der Vergangenheit oder weit in der Zukunft
    assert.equal((await t.call('/api/garmin/send', { date: '2020-01-01' })).status, 400);
    // trennen
    await t.call('/api/garmin/disconnect', {});
    assert.equal((await (await t.call('/api/garmin/state')).json()).connected, false);
  } finally { setHttp(null); t.close(); }
});
