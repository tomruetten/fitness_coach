// Lädt alles, was die Planengine für einen Stichtag braucht.
import { DEFAULT_SETTINGS } from './engine/config.js';
import { withDefaults } from './engine/planner.js';
import { addDays, mondayOf } from './engine/dates.js';
import { legacyLog } from './engine/strength.js';

export const todayIn = (tz = DEFAULT_SETTINGS.timezone) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function loadSettings(store) {
  const saved = (await store.getSetting('settings')) || {};
  const s = withDefaults(saved);
  if (!saved.block_start) {
    // Der Blockzähler startet mit dem Montag der ersten Nutzung.
    s.block_start = mondayOf(todayIn(s.timezone));
    await store.setSetting('settings', { ...saved, block_start: s.block_start });
  }
  return s;
}

export async function loadContext(store, { date } = {}) {
  const settings = await loadSettings(store);
  const today = todayIn(settings.timezone);
  const d = date || today;
  const [activities, days, oldLog, sets, pain] = await Promise.all([
    store.activitiesSince(addDays(d, -130)),
    store.daysSince(addDays(d, -75)),
    store.strengthSince(addDays(d, -90)),
    store.setsSince(addDays(d, -120)),
    store.painSince(addDays(d, -30)),
  ]);
  const strengthLog = [...oldLog, ...legacyLog(sets.filter((x) => x.date >= addDays(d, -90)))];
  return { date: d, today, settings, activities, days, strengthLog, sets, pain };
}
