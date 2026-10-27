import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createMemoryStore } from '../server/db/memory.js';
import { COOKIE, createToken } from '../server/auth/session.js';

async function boot() {
  const store = createMemoryStore();
  const app = createApp({ store });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { body, auth = true, headers = {} } = {}) => fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Requested-With': 'fit', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Cookie: `${COOKIE}=${createToken()}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { call, store, close: () => server.close() };
}

test('API verlangt Anmeldung und Header', async () => {
  const t = await boot();
  assert.equal((await t.call('/api/today', { auth: false })).status, 401);
  t.close();
});

test('heute, woche, trends, einstellungen laufen mit leerer Datenbank', async () => {
  const t = await boot();
  for (const p of ['/api/today', '/api/week', '/api/trends', '/api/settings', '/api/activities']) {
    const r = await t.call(p);
    assert.equal(r.status, 200, p);
    await r.json();
  }
  const w = await (await t.call('/api/week')).json();
  assert.equal(w.week.length, 7);
  assert.ok(w.week.some((d) => d.kind === 'spinning' && d.weekday === 'Dienstag'));
  t.close();
});

test('Einstellungen werden validiert und gespeichert', async () => {
  const t = await boot();
  await t.call('/api/settings', { body: { lthr: 999, max_hr: 200, goal: { time_s: 6500, date: '2027-03-14' } } });
  const s = await (await t.call('/api/settings')).json();
  assert.equal(s.max_hr, 200);
  assert.equal(s.lthr, 181);
  assert.equal(s.goal.date, '2027-03-14');
  t.close();
});

test('Schmerz und Kraft-Protokoll', async () => {
  const t = await boot();
  assert.equal((await t.call('/api/pain', { body: { level: 11 } })).status, 400);
  assert.equal((await t.call('/api/pain', { body: { level: 5, area: 'Knie' } })).status, 200);
  const r = await (await t.call('/api/strength/log', { body: { entries: [{ exercise_id: 'split_squat', sets: 3, reps: '8', weight_kg: 20 }] } })).json();
  assert.equal(r.saved, 1);
  t.close();
});

test('Cron nur mit Secret, Registrierung nur mit Setup-Token', async () => {
  const t = await boot();
  process.env.CRON_SECRET = 'abc';
  assert.equal((await t.call('/api/cron/sync', { auth: false })).status, 401);
  process.env.SETUP_TOKEN = 'setup-xyz';
  assert.equal((await t.call('/api/auth/register/options', { auth: false, body: { setupToken: 'falsch' } })).status, 403);
  const ok = await t.call('/api/auth/register/options', { auth: false, body: { setupToken: 'setup-xyz' } });
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).options.challenge);
  t.close();
});
