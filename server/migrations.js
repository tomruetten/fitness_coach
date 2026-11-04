// Einmalige Datenkorrekturen. Jede läuft genau einmal (Merker in den Einstellungen) und wird beim nächsten Aufruf der App ausgeführt.
const MIGRATIONS = [
  {
    id: '2026-11-04-gewichte-runden',
    // Gewichte vom 04.11.2026: 7,5 kg wurden zu 8 kg, 12,5 kg zu 12 kg
    run: (store) => store.remapWeights('2026-11-04', { 7.5: 8, 12.5: 12 }),
  },
];

const checked = new WeakSet();
export async function runMigrations(store) {
  if (checked.has(store)) return;
  const done = (await store.getSetting('migrations_done')) || [];
  const todo = MIGRATIONS.filter((m) => !done.includes(m.id));
  for (const m of todo) {
    try { await m.run(store); done.push(m.id); } catch (e) { console.error('Migration fehlgeschlagen', m.id, e.message); return; }
  }
  if (todo.length) await store.setSetting('migrations_done', done);
  checked.add(store);
}
