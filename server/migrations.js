// Einmalige Datenkorrekturen. Jede läuft genau einmal (Merker in den Einstellungen) und wird beim nächsten Aufruf der App ausgeführt.
const MIGRATIONS = [
  {
    id: '2026-11-04-gewichte-runden',
    // Gewichte vom 04.11.2026: 7,5 kg wurden zu 8 kg, 12,5 kg zu 12 kg
    run: (store) => store.remapWeights('2026-11-04', { 7.5: 8, 12.5: 12 }),
  },
  {
    id: '2026-11-04-workout-speichern',
    // Das Training vom 04.11.2026 nachträglich als Workout „Oberkörper/ Single Leg“ speichern
    run: async (store) => {
      const rows = (await store.setsSince('2026-11-04')).filter((s) => s.date === '2026-11-04' && s.done !== false);
      if (!rows.length) return false; // noch nichts protokolliert: später erneut versuchen
      const by = new Map();
      for (const s of rows.sort((a, b) => a.set_no - b.set_no)) {
        const e = by.get(s.exercise_id) || { id: s.exercise_id, name: s.exercise_name, sets: 0, reps: String(s.reps) };
        e.sets++;
        by.set(s.exercise_id, e);
      }
      const all = (await store.getSetting('saved_workouts')) || [];
      const name = 'Oberkörper/ Single Leg';
      const w = { id: 'w_20261104', name, exercises: [...by.values()].slice(0, 15) };
      const i = all.findIndex((x) => x.name === name);
      if (i >= 0) all[i] = w; else all.push(w);
      await store.setSetting('saved_workouts', all);
    },
  },
];

const checked = new WeakSet();
export async function runMigrations(store) {
  if (checked.has(store)) return;
  const done = (await store.getSetting('migrations_done')) || [];
  let pending = false;
  const todo = MIGRATIONS.filter((m) => !done.includes(m.id));
  for (const m of todo) {
    try { const r = await m.run(store); if (r === false) { pending = true; continue; } done.push(m.id); } catch (e) { console.error('Migration fehlgeschlagen', m.id, e.message); return; }
  }
  if (todo.length) await store.setSetting('migrations_done', done);
  if (!pending) checked.add(store);
}
