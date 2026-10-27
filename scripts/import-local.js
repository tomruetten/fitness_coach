// Einmaliger Verlaufsimport in die Datenbank (Supabase, wenn SUPABASE_URL und SUPABASE_SERVICE_KEY gesetzt sind).
// Aufruf: node scripts/import-local.js <ordner>   (Ordner mit activities.json und health/*.json)
// Alternativ nur FIT-Dateien: node scripts/import-local.js <ordner> --fit   (liest <ordner>/fit/*.fit)
import fs from 'fs';
import path from 'path';
import { getStore } from '../server/db/index.js';
import { loadHealthDays, loadHistory } from './history.js';
import { activityFromFit } from '../server/garmin/fit.js';
import { DEFAULT_SETTINGS } from '../server/engine/config.js';

const dir = process.argv[2];
if (!dir) { console.error('Aufruf: node scripts/import-local.js <ordner> [--fit]'); process.exit(1); }
const store = getStore();
const saved = (await store.getSetting('settings')) || {};
const lthr = saved.lthr || DEFAULT_SETTINGS.lthr;
const tz = saved.timezone || DEFAULT_SETTINGS.timezone;

let activities;
if (process.argv.includes('--fit')) {
  activities = [];
  const fitDir = path.join(dir, 'fit');
  for (const f of fs.readdirSync(fitDir).filter((x) => x.endsWith('.fit'))) {
    try { activities.push(await activityFromFit(fs.readFileSync(path.join(fitDir, f)), { activityId: path.basename(f, '.fit'), lthr, tz })); }
    catch (e) { console.warn('übersprungen:', f, e.message); }
  }
} else {
  activities = loadHistory(dir).activities;
}
const days = loadHealthDays(dir);
for (let i = 0; i < activities.length; i += 50) await store.upsertActivities(activities.slice(i, i + 50));
for (let i = 0; i < days.length; i += 200) await store.upsertDays(days.slice(i, i + 200));
console.log(`Importiert: ${activities.length} Aktivitäten, ${days.length} Tage.`);
