import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../server/db/memory.js';
import { runNotifications } from '../server/notify.js';
import { todayIn } from '../server/context.js';

async function setup(kind, status) {
  const store = createMemoryStore(null);
  const today = todayIn('Europe/Berlin');
  await store.setSetting('push_subs', [{ endpoint: 'https://example.test/1', keys: { p256dh: 'a', auth: 'b' } }]);
  await store.setSetting('day_overrides', { [today]: kind });
  if (status) await store.setSetting('day_status', { [today]: status });
  const calls = [];
  const send = async (subs, payload) => { calls.push(payload); return { subs, sent: subs.length }; };
  return { store, calls, send, today };
}

test('Abendmitteilung kommt, wenn die Einheit offen ist', async () => {
  const { store, calls, send } = await setup('run_quality');
  const r = await runNotifications({ store, send, hour: 22 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].title, /eintragen/i);
  assert.equal(r.sent[0].id, 'evening');
});

test('keine Abendmitteilung bei Status erledigt, ausgefallen oder Ruhetag', async () => {
  for (const [kind, status] of [['run_quality', 'done'], ['run_quality', 'skipped'], ['rest', null]]) {
    const { store, calls, send } = await setup(kind, status);
    await runNotifications({ store, send, hour: 22 });
    assert.equal(calls.length, 0, `${kind}/${status}`);
  }
});

test('Zeitfenster, Tageslimit und Einstellung werden beachtet', async () => {
  const a = await setup('run_quality');
  await runNotifications({ store: a.store, send: a.send, hour: 14 });
  assert.equal(a.calls.length, 0, 'außerhalb des Fensters');
  await runNotifications({ store: a.store, send: a.send, hour: 22 });
  await runNotifications({ store: a.store, send: a.send, hour: 23 });
  assert.equal(a.calls.length, 1, 'höchstens einmal pro Tag');
  const b = await setup('run_quality');
  await b.store.setSetting('notify_prefs', { evening: false });
  await runNotifications({ store: b.store, send: b.send, hour: 22 });
  assert.equal(b.calls.length, 0, 'ausgeschaltet');
});

test('Morgenmitteilung nennt die Einheit', async () => {
  const { store, calls, send } = await setup('run_quality');
  await runNotifications({ store, send, hour: 6 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].title, /Heute/);
});

test('Abend: von Garmin erkannte Aktivität zählt als eingetragen', async () => {
  const { store, calls, send, today } = await setup('run_quality');
  await store.upsertActivities([{ id: 1, start_time: today + 'T17:00:00Z', local_date: today, sport: 'running', duration_s: 1800, distance_m: 5000 }]);
  await runNotifications({ store, send, hour: 22 });
  assert.equal(calls.length, 0);
});
